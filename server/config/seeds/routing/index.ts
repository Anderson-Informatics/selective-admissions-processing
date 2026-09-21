import appHs from './app-hs.json'
import dsa from './dsa.json'
import ehs9 from './ehs-9th-grade.json'
import ehsCurrent from './ehs-current-hs.json'
import ehsTransfer from './ehs-transfer.json'

export const routingTemplates = {
  'app-hs': appHs,
  dsa,
  'ehs-9th-grade': ehs9,
  'ehs-current-hs': ehsCurrent,
  'ehs-transfer': ehsTransfer
} as const

export type RoutingTemplateName = keyof typeof routingTemplates
