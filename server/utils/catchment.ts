import type { AnyBulkWriteOperation } from 'mongoose'
import type { JobProgress } from '../models/Job'
import { CatchmentZoneModel } from '../models/CatchmentZone'
import { SubmissionModel, type Submission } from '../models/Submission'
import { mapWithConcurrency } from './concurrency'
import seedZones from '../config/seeds/catchment-zones.json'

export type MarygroveCatchment = 'Primary' | 'Secondary' | 'None'

export interface GeocodeResult {
  lat: number
  lng: number
  formattedAddress?: string
}

export interface CatchmentProcessResult {
  submissionId: string
  geocodeStatus: 'ok' | 'failed' | 'no_address' | 'skipped'
  marygrove: MarygroveCatchment
  error?: string
}

const HERE_GEOCODE_URL = 'https://geocode.search.hereapi.com/v1/geocode'

let _seeded = false

export async function ensureCatchmentZonesSeeded() {
  const count = await CatchmentZoneModel.estimatedDocumentCount()
  if (!count) {
    await CatchmentZoneModel.insertMany(seedZones)
  }
  if (!_seeded) {
    await CatchmentZoneModel.createIndexes()
    _seeded = true
  }
}

export function buildAddress(mappedFields: Record<string, unknown> | undefined): string {
  const fields = mappedFields || {}
  const parts = ['Address1', 'Address2', 'City', 'State', 'Zip', 'Country']
    .map(key => String(fields[key] || '').trim())
    .filter(Boolean)
  const hasStreet = Boolean(String(fields.Address1 || '').trim())
  const hasZip = Boolean(String(fields.Zip || '').trim())
  if (!hasStreet && !hasZip) return ''
  return parts.join(', ')
}

export function normalizeAddress(address: string): string {
  return address.toLowerCase().replace(/\s+/g, ' ').trim()
}

export async function geocodeAddress(address: string, apiKey: string): Promise<GeocodeResult | null> {
  try {
    const params = new URLSearchParams({ q: address, apiKey })
    const response = await fetch(`${HERE_GEOCODE_URL}?${params.toString()}`)
    if (!response.ok) return null
    const body = await response.json() as { items?: { access?: { lat: number, lng: number }[], position?: { lat: number, lng: number }, address?: { label?: string } }[] }
    const item = body?.items?.[0]
    if (!item) return null
    const point = item.access?.[0] || item.position
    if (!point || typeof point.lat !== 'number' || typeof point.lng !== 'number') return null
    return { lat: point.lat, lng: point.lng, formattedAddress: item.address?.label }
  } catch {
    return null
  }
}

export async function lookupMarygroveCatchment(lat: number, lng: number): Promise<MarygroveCatchment> {
  const point = { type: 'Point', coordinates: [lng, lat] }
  const zones = await CatchmentZoneModel.find({
    name: 'Marygrove',
    geometry: { $geoIntersects: { $geometry: point } }
  }).select('type').lean()
  const types = zones.map(zone => zone.type)
  if (types.includes('Primary')) return 'Primary'
  if (types.includes('Secondary')) return 'Secondary'
  return 'None'
}

export async function processSubmissionCatchment(
  submission: Pick<Submission, 'submissionId' | 'mappedFields' | 'geocode' | 'catchment'>,
  options: { hereApiKey: string, force?: boolean }
): Promise<CatchmentProcessResult> {
  const { hereApiKey, force } = options
  const address = buildAddress(submission.mappedFields)
  const now = new Date()

  if (!address) {
    const geocode = { status: 'no_address' as const, geocodedAt: now }
    const catchment = { marygrove: 'None' as const, checkedAt: now }
    await SubmissionModel.updateOne({ submissionId: submission.submissionId }, { $set: { geocode, catchment } })
    return { submissionId: submission.submissionId, geocodeStatus: 'no_address', marygrove: 'None' }
  }

  if (!force && submission.geocode?.status === 'ok' && normalizeAddress(submission.geocode.address || '') === normalizeAddress(address)) {
    return { submissionId: submission.submissionId, geocodeStatus: 'skipped', marygrove: submission.catchment?.marygrove || 'None' }
  }

  const result = await geocodeAddress(address, hereApiKey)
  if (!result) {
    const geocode = { status: 'failed' as const, address, error: 'No geocoding result', geocodedAt: now }
    const catchment = { marygrove: 'None' as const, checkedAt: now }
    await SubmissionModel.updateOne({ submissionId: submission.submissionId }, { $set: { geocode, catchment } })
    return { submissionId: submission.submissionId, geocodeStatus: 'failed', marygrove: 'None', error: 'No geocoding result' }
  }

  const marygrove = await lookupMarygroveCatchment(result.lat, result.lng)
  const geocode = { status: 'ok' as const, address, formattedAddress: result.formattedAddress, lat: result.lat, lng: result.lng, geocodedAt: now }
  const catchment = { marygrove, checkedAt: now }
  await SubmissionModel.updateOne({ submissionId: submission.submissionId }, { $set: { geocode, catchment } })
  return { submissionId: submission.submissionId, geocodeStatus: 'ok', marygrove }
}

export async function runCatchmentForCycle(
  cycleId: string,
  setProgress?: (progress: Partial<JobProgress>) => Promise<void>,
  options: { hereApiKey?: string, force?: boolean } = {}
) {
  const { hereApiKey, force } = options
  if (!hereApiKey) throw new Error('NUXT_HERE_API_KEY is not configured')

  await ensureCatchmentZonesSeeded()

  await setProgress?.({ phase: 'loading', message: 'Loading submissions', total: 0, processed: 0, percent: 0 })

  const submissions = await SubmissionModel.find({ cycleId })
    .select('submissionId status mappedFields geocode')
    .lean()

  const active = submissions.filter(sub => sub.status?.toLowerCase() !== 'withdrawn')
  const now = new Date()

  type WorkItem = { submission: typeof active[number], address: string, normalized: string }
  const noAddress: typeof active = []
  const skipped: typeof active = []
  const toGeocode: WorkItem[] = []

  for (const submission of active) {
    const address = buildAddress(submission.mappedFields)
    if (!address) {
      noAddress.push(submission)
      continue
    }
    const normalized = normalizeAddress(address)
    if (!force && submission.geocode?.status === 'ok' && normalizeAddress(submission.geocode.address || '') === normalized) {
      skipped.push(submission)
      continue
    }
    toGeocode.push({ submission, address, normalized })
  }

  const uniqueAddresses = [...new Map(toGeocode.map(item => [item.normalized, item.address])).entries()]

  await setProgress?.({
    phase: 'geocoding',
    message: `Geocoding ${uniqueAddresses.length} unique addresses (${toGeocode.length} submissions)`,
    total: uniqueAddresses.length,
    processed: 0,
    percent: uniqueAddresses.length ? 0 : 100
  })

  const geocodeByAddress = new Map<string, GeocodeResult | null>()
  let geocodedCount = 0
  await mapWithConcurrency(uniqueAddresses, 2, async ([normalized, address]) => {
    const result = await geocodeAddress(address, hereApiKey)
    geocodeByAddress.set(normalized, result)
    geocodedCount += 1
    await new Promise(resolve => setTimeout(resolve, 25))
    if (geocodedCount % 20 === 0 || geocodedCount === uniqueAddresses.length) {
      await setProgress?.({
        phase: 'geocoding',
        message: `Geocoded ${geocodedCount} / ${uniqueAddresses.length} unique addresses`,
        total: uniqueAddresses.length,
        processed: geocodedCount,
        percent: Math.round((geocodedCount / uniqueAddresses.length) * 100)
      })
    }
  })

  await setProgress?.({ phase: 'catchment', message: 'Running catchment lookups', total: active.length, processed: 0, percent: 0 })

  const operations: AnyBulkWriteOperation<Submission>[] = []
  const summary = {
    total: active.length,
    geocoded: 0,
    reused: skipped.length,
    noAddress: noAddress.length,
    failed: 0,
    primary: 0,
    secondary: 0,
    none: 0
  }

  for (const submission of noAddress) {
    operations.push({
      updateOne: {
        filter: { submissionId: submission.submissionId },
        update: { $set: { geocode: { status: 'no_address', geocodedAt: now }, catchment: { marygrove: 'None', checkedAt: now } } }
      }
    })
    summary.none += 1
  }

  let lookedUp = 0
  await mapWithConcurrency(toGeocode, 8, async (item) => {
    const { submission, address, normalized } = item
    const result = geocodeByAddress.get(normalized)
    if (!result) {
      summary.failed += 1
      summary.none += 1
      operations.push({
        updateOne: {
          filter: { submissionId: submission.submissionId },
          update: { $set: { geocode: { status: 'failed', address, error: 'No geocoding result', geocodedAt: now }, catchment: { marygrove: 'None', checkedAt: now } } }
        }
      })
    } else {
      const marygrove = await lookupMarygroveCatchment(result.lat, result.lng)
      summary.geocoded += 1
      if (marygrove === 'Primary') summary.primary += 1
      else if (marygrove === 'Secondary') summary.secondary += 1
      else summary.none += 1
      operations.push({
        updateOne: {
          filter: { submissionId: submission.submissionId },
          update: {
            $set: {
              geocode: { status: 'ok', address, formattedAddress: result.formattedAddress, lat: result.lat, lng: result.lng, geocodedAt: now },
              catchment: { marygrove, checkedAt: now }
            }
          }
        }
      })
    }
    lookedUp += 1
    if (lookedUp % 50 === 0 || lookedUp === toGeocode.length) {
      await setProgress?.({
        phase: 'catchment',
        message: `Checked ${lookedUp + skipped.length + noAddress.length} / ${active.length} submissions`,
        total: active.length,
        processed: lookedUp + skipped.length + noAddress.length,
        percent: Math.round(((lookedUp + skipped.length + noAddress.length) / active.length) * 100)
      })
    }
  })

  const batchSize = 500
  for (let index = 0; index < operations.length; index += batchSize) {
    await SubmissionModel.bulkWrite(operations.slice(index, index + batchSize))
  }

  await setProgress?.({
    phase: 'completed',
    message: `Catchment lookup complete: ${summary.primary} primary, ${summary.secondary} secondary, ${summary.failed} failed`,
    total: active.length,
    processed: active.length,
    percent: 100
  })

  return summary
}
