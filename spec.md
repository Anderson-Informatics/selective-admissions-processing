# EHS Admissions Automation — Technical Specification

[← Product Features](features.html)

A web application for DPSCD admissions staff to trigger, monitor, and manage the entire Examination High Schools (EHS) / Application High Schools (AHS) admissions data pipeline.

## 1. Purpose & Background

The current pipeline is a collection of Python scripts that pull data from Submittable, normalize it, run business rules, write scores back to Submittable, and upload rosters to MongoDB lookup tools. The scripts are powerful but hard to maintain: configuration is hard-coded, errors are printed to the console, and each cycle requires a developer to edit source files.

This spec defines a successor application built on **Nuxt 4 + Nuxt UI v4 + Mongoose/MongoDB**, deployed on **Netlify**. It replaces the monolithic Python class with a configuration-driven, domain-driven system where admissions staff can trigger jobs, review data-quality issues, monitor progress, and prepare final placement data with minimal engineering support year over year.

## 2. Goals

1. **Triggerable processing steps** — run data extraction, compilation, routing, scoring, and roster uploads as discrete, trackable jobs from a web UI.
2. **Data quality monitoring** — surface common errors and inconsistencies such as out-of-range DOBs, bad student numbers, parent/ student name swaps, duplicates, missing documents, and incomplete review stages.
3. **High-level dashboard** — show counts, completion rates, stage progress, exam registrations, scoring status, and validation issues by school and cycle.
4. **Scoring & placement prep** — compile the scoring file, update Submittable internal forms, and produce clean input for the placement algorithm (to be added later).
5. **Year-over-year configurability** — make form mappings, review stages, validation rules, scoring weights, and school/label definitions configurable per cycle without code changes.

## 3. Users & Authentication

There is a single access level: **logged in or not**. All authenticated users can trigger jobs, view the dashboard, drill into submissions, manage configuration, and export data. Unauthenticated users cannot access any application features.

The actual admissions reviews happen inside Submittable. This application surfaces data-quality issues and makes it easy to identify and jump to the relevant submission in Submittable.

### Authentication Approach

- **Phase 1 (starter)**: email and password authentication. Credentials are stored in the `.env` file as a simple comma-separated or JSON list; no user database or complex workflow is required to start.
- **Phase 2 (future)**: replace the `.env` login with MSAL-based SSO once the Azure app is configured to accept it.

## 4. Tech Stack

| Layer | Choice | Notes |
|-------|--------|-------|
| Framework | Nuxt 4.2+ | Latest stable Nuxt, Nitro server. |
| UI Library | Nuxt UI v4 | `@nuxt/ui`, Tailwind CSS 4 based. |
| Language | TypeScript | Shared types across app and server. |
| ORM | Mongoose | MongoDB schemas and queries. |
| Database | MongoDB Atlas / existing cluster | Re-uses existing lookup-tool and app DBs. |
| Deployment | Netlify | Nitro preset `netlify`; background functions for long jobs. |
| Testing | Vitest + nuxt/test-utils | Unit tests for rules, API tests for routes. |
| Logging | `consola` / `pino` | Structured server logs. |

## 5. Architecture Overview

The application is organized as a **Nuxt 4 monorepo-style project** with a Vue frontend, Nitro server routes, and Mongoose models. The monolithic Python `Submittable` class is decomposed into focused domain services plus a job runner.

### Server-side Services

- `submittable/` — typed HTTP client, auth, pagination, retry logic, and bulk operations.
- `extraction/` — metadata sync, form response extraction, field mapping.
- `validation/` — rule engine that produces `ValidationIssue` records.
- `routing/` — Application-HS and DSA stage-routing logic.
- `scoring/` — HSPT, GPA, essay, DPSCD bonus, Marygrove bonus/catchment scoring.
- `roster/` — lookup-tool upserts for `ehs` and `app` collections.
- `catchment/` — geocoding and MongoDB `$geoIntersects` queries.
- `notifications/` — webhook/Teams alerts and audit logs.
- `jobs/` — job runner and background-function handlers.

### Frontend

- Dashboard layout with summary cards, tables, and drill-down panels.
- Job runner panel to trigger, monitor, and re-run jobs.
- Configuration editors for cycles, schools, form mappings, review stages, validation rules, and scoring config.
- Submission detail view with raw fields, extracted fields, labels, validation issues, scores, and routing history.

## 6. Data Model

Core MongoDB collections:

- `Cycle` — admissions year, active flag, date ranges, score weights.
- `School` — name, type, Submittable `projectId`, `initialFormId`, review stage definitions, catchment info.
- `ReviewStage` — `stageId`, `projectId`, `formId`, order, `requiredForProgress`, year.
- `FormDefinition` — `formId`, `name`, `formType`, version, year, `fieldMappings[]`.
- `Submission` — `submissionId`, `submissionIdInt`, cycle, project, school, status, stage, `labelIds`, assignments, raw entry, extracted fields, `hsptResultId`, `hsptMatchType`.
- `FormResponse` — per-form response documents linked to submissions.
- `ValidationIssue` — issue type, field, message, severity, status, resolution tracking.
- `Job` — type, payload, status, progress, total, logs, timestamps, error.
- `HSPTResult` — raw STS test record for a single student, computed scaled scores, `resultId`, `optCd`, `linkedSubmissionId`, `matchType`, `matchScore`, `status`, cycle, and source file.
- `GpaRecord` — per-submission GPA data by source: `dpscd` (student number, `quartersAvailable`, `cumulativeGpa`, status, extras) and `optIn` (names, DOB, enrollment terms flag, `cumulativeGpa`, school name), plus provenance (job/upload id, timestamps).
- `GpaUpload` — staged GPA import holding raw `records` (DPSCD JSON payload) or base64 `files` (Opt-In XLSX), status lifecycle, preview/result, job references, TTL expiry.
- `ScoreRecord` — exam, GPA, essay, bonuses, `totalAppScore`, `totalMgScore`.
- `PlacementScenario` — per-scenario inputs: name, cycle, capacities, cut scores, minimum GPA/exam thresholds.
- `PlacementResult` — assignment, choice rank, and scenario for each applicant.
- `AuditLog` — who triggered what and when.

## 7. Configuration-Driven Year-over-Year Support

The previous system embeds form UUIDs, field labels, stage IDs, school names, and score weights in code. The new system stores these in MongoDB and exposes them in admin UIs.

1. **Cycles** — clone the previous cycle to create a new one; most settings copy forward.
2. **Schools & Review Stages** — map each cycle's Submittable `projectId` and `stageId` by name; store resolved UUIDs.
3. **Form Definitions** — import a form from Submittable and map its labels to canonical fields. New fields are flagged and must be mapped before extraction.
4. **Validation Rules** — stored as documents; toggle per cycle.
5. **Scoring Config** — age cut-offs, GPA point table, weights, and bonus values live in `Cycle`/`ScoringConfig`.
6. **Label Mappings** — school-choice labels, exam labels, and MontMG labels are configured per cycle.
7. **Seed files** — optional checked-in JSON/YAML under `server/config/seeds/` for bootstrapping fresh environments. The database is the runtime source of truth.

## 8. Job Runner & Processing Pipeline

Each major legacy script step becomes a discrete, triggerable job. Jobs are stored in the `Job` collection and report status, progress, and logs.

| Job | Purpose |
|-----|---------|
| `extractMetadata` | Sync projects, forms, labels, users, review stages from Submittable. |
| `extractSubmissions` | Pull submissions for selected projects and upsert `Submission` docs. |
| `extractFormResponses` | Pull entries for a form and store `FormResponse` docs. |
| `mapFields` | Apply `FormDefinition.fieldMappings` to populate `Submission.extractedFields`. |
| `runValidation` | Execute validation rules and create/resolve `ValidationIssue` records. |
| `compileApplications` | Combine AHS applications across the five schools. |
| `extractReviews` | Pull completion, decision, and DSA decision review forms. |
| `runAppHsRouting` | Move Application-HS submissions based on completion/decision scores. |
| `runDsaRouting` | Move DSA submissions based on initial/audition/decision scores. |
| `compileDsaAuditions` | Aggregate the seven DSA audition forms per applicant. |
| `dpscdGpaImport` | Import DPSCD GPA records posted as a JSON payload; match to submissions and upsert `GpaRecord.dpscd`. |
| `optinGpaPreview` | Parse uploaded Opt-In XLSX files, match rows by `submissionIdInt`, flag label/match issues. |
| `optinGpaCommit` | Upsert confirmed Opt-In GPA rows into `GpaRecord.optIn`. |
| `compileScores` | Combine HSPT, GPA, essay, DPSCD bonus, Marygrove bonus/catchment. |
| `updateInternalForms` | Write computed scores back to Submittable internal forms. |
| `compileRosters` | Upsert exam/lookup rosters to MongoDB collections. |
| `runPlacement` | Placeholder for the future placement algorithm. |
| `exportCsv` | Generate CSVs for staff or downstream systems. |

### Execution

- Fast API calls (reads, job creation) use standard Nitro routes.
- Long-running jobs run as **Netlify background functions** to avoid timeout limits.
- Jobs are idempotent and resumable: progress is persisted after each batch.
- The UI polls `Job` documents for status updates.

## 9. Data Extraction & Form Mapping

The legacy `get_form_data` contains a giant hard-coded dictionary mapping Submittable field labels to column names. The new system replaces that with dynamic `FormDefinition.fieldMappings`:

- Import a form schema from Submittable.
- Each field is stored with its label, type, and options.
- Staff map Submittable labels to canonical fields (`FirstName`, `DOB`, `FirstChoiceSchool`, etc.).
- Extraction runs the mappings and stores the normalized result.
- Unmapped fields are flagged and block extraction until resolved.

## 10. Validation & Data Quality

The validation engine runs configurable rules against submissions and produces `ValidationIssue` records.

Planned rules:

- DOB out of range for the selected grade and cycle year.
- Student number format issues (non-numeric, wrong length, leading zeros).
- Parent/ student name swap (first/last match parent fields).
- Duplicate applicants by `FILADOB`, full name, or first+last.
- Missing required documents (IEP, 504, transcripts, report cards) based on applicant flags.
- Label inconsistency (school choice labels not matching form values).
- Incomplete review stages.
- Geocoding or catchment failures.

Issues are shown in a dashboard with filters, severity, and drill-down to the submission.

## 11. HSPT Upload & Matching

HSPT results arrive from STS as raw CSV files (one per test center or administration). The application ingests these files, normalizes the columns, computes scaled scores, and links each test record to the corresponding application.

### Data Storage Recommendation

The previous workflow used a 4-digit `ResultID` assigned by STS and maintained a separate "merge" dataset that linked a `submissionId` to the test record. Because the same `ResultID` range can appear in multiple STS files (e.g., each file starts at 1000), the new application should not rely on `ResultID` alone as a global key. Instead:

- Each imported STS row is stored as an `HSPTResult` document with a unique database identifier.
- `ResultID`, `HPID`, test center/batch, and cycle are kept as source identifiers.
- The link to an application is stored directly on the `HSPTResult` (`linkedSubmissionId`) and mirrored on the `Submission` (`hsptResultId`, `hsptMatchType`).
- This makes the `HSPTResult` collection itself the merge dataset; no separate merge file is required.

### Score Conversion

The raw STS files contain sub-scores such as `RDRS`, `MTRS`, `LNRS`, and `OPRS`. The application computes scaled scores using the same formulas used historically:

- Reading = `RDRS / 62 * 11.25`
- Math = `MTRS / 64 * 15`
- Language = `LNRS / 60 * 11.25`
- Science = `OPRS / 40 * 7.5`
- Overall = Reading + Math + Language + Science

These values are stored on the `HSPTResult` and used by the scoring compilation job.

### Upload Process

1. Select the active cycle and test administration.
2. Upload one or more raw STS CSV files.
3. The system parses each row, computes scaled scores, and creates `HSPTResult` records.
4. Existing records for the same cycle + `ResultID` + `HPID` + test center are overwritten on re-upload to support corrections.

### Matching Process

The system attempts to link each `HSPTResult` to a `Submission` in three stages:

1. **OptCd exact match** — For DPSCD students, match `HSPTResult.OptCd` to `Submission.StudentNumber`; for non-DPSCD students, match `HSPTResult.OptCd` to `Submission.submissionIdInt`. If a match is found, mark it as matched with type `OptCd`.
2. **Fuzzy match** — For unmatched records, compare `First`, `Last`, and `Birth` against all unlinked submissions. A match score is computed from string similarity on names and exact date-of-birth equality. The top candidate(s) are shown in the match review table with match type such as `Name+DOB`, `Name only`, or `DOB only`.
3. **Manual review & link** — A match review page displays side-by-side data: HSPT record (name, DOB, OptCd, scores) and candidate submission (name, student number or submission ID, DOB, school choices). Each row shows the match score, match type, and Accept / Reject actions. Rejecting a fuzzy match leaves the record unlinked; accepting records the link and updates the `Submission`. Users can also unlink a previously accepted match.

### HSPT Results Search & Manual Linking

A dedicated HSPT Results page lists all imported test records. Users can:

- Search by first name, last name, or date of birth.
- See the linked status of each record.
- Open a "Link application" action on an unlinked record, which opens a searchable dropdown of all unlinked submissions (searched by `FullName`).
- Select the correct submission to create the link.

### Integration with Scoring

The score compilation job uses the linked `HSPTResult` to populate `Exam_Score` and the Reading, Math, Language, and Science sub-scores for each applicant. Records without a linked submission are excluded from scoring until matched.

## 12. GPA Data Ingestion

Two additional GPA sources supplement the GPA recorded through review forms. Both feed the score compilation job, which resolves a single `CumulativeGPA` per applicant.

### Submission Labels

Opt-In students are identified by the presence of the "Opt-In" label on their Submittable submission. Submission extraction stores each submission's `labelIds` (from the v4 `/submissions` list) on the `Submission` document, and the GPA tooling resolves the Opt-In label id from the synced `Metadata` label catalog (case-insensitive `opt-in`/`opt in`/`optin` name match). Cycles extracted before labels were captured are backfilled lazily from Submittable when an Opt-In import runs.

### DPSCD GPA Import (API)

DPSCD GPA data is delivered to `POST /api/gpa/dpscd` as a JSON body: `{ cycleId, records: [...] }` (a bare top-level array is also accepted). The sender may emit strict JSON or Python-style repr output (single quotes, `None`/`True`/`False`/`nan`); the endpoint normalizes both before staging.

- The endpoint validates the envelope, stores the raw records on a `GpaUpload` staging document (`source: 'dpscd'`), queues a `dpscd_gpa_import` background job, and returns `{ uploadId, jobId }`. `GET /api/gpa/dpscd/{uploadId}` returns upload + job status for polling.
- The job matches each record to a `Submission` within the cycle by `submissionId` GUID, then `submissionIdInt`, then `StudentNumber`. Payloads may span multiple years/projects; records that do not match a submission in the cycle are counted as unmatched, not fatal.
- Integer-semantic fields (`STUDENT_NUMBER`, `submissionIdInt`, `Quarters Available`, `Latest_GRADE_LEVEL`, `Middle School Number`, `Accepting High School Number`) are coerced to integers; `gpa_cumulative` remains a decimal. All remaining payload fields are preserved under `dpscd.extra`.
- Results are upserted into `GpaRecord.dpscd` keyed `(cycleId, submissionId)` — the last import wins and provenance (`importJobId`, `importedAt`) is stamped. The job result reports processed/matched/updated/unmatched counts plus per-record warnings and errors, and is visible in the Jobs log.

### Opt-In GPA Upload (UI)

Out-of-district opt-in schools return per-school XLSX files containing a `SCHOOL NAME:` banner row and columns for `SubmissionID` (the integer id), student name/DOB, "Enrolled … at least 3 semesters/4 trimesters? (Yes/No)", "how many terms", and "Cumulative Middle School GPA".

- The GPA page provides a staged upload flow identical to HSPT: select one or more `.xlsx` files → a preview job parses each file, extracts the school name, matches rows to submissions by `submissionIdInt`, and reports per-row status (`matched`, `missing_optin_label`, `unmatched`, `invalid_gpa`, `not_enrolled`) plus the count of Opt-In-labeled submissions absent from the files.
- The preview is read-only; corrections are made by fixing the file and re-uploading. Rows whose submission lacks the Opt-In label are imported but flagged as warnings.
- Confirming queues a commit job that upserts `GpaRecord.optIn` for matched rows only — only submissions whose `submissionIdInt` appears in the uploaded files are modified.

### Cumulative GPA Resolution (score compilation scope)

When `compileScores` runs, the effective GPA is selected by priority:

1. `CumulativeGPA` recorded on the GPA Recording review form.
2. `GpaRecord.dpscd.cumulativeGpa` when `quartersAvailable >= 6`.
3. `GpaRecord.optIn.cumulativeGpa` when the student was enrolled at least 3 semesters/4 trimesters (Yes, case-insensitive).
4. The partial GPA review form (`PartialGPA`/`Semesters`).

## 13. Dashboard & Reporting

The dashboard gives admissions staff a real-time view of the pipeline.

- Summary cards: total applications, applications by school, by stage, validation issues, completed reviews, exam registrations, scoring completion.
- Tables: submissions, validation issues, jobs, review stage completion.
- Filters: cycle, school, stage, status, severity.
- Submission detail: raw and extracted fields, labels, assignments, validation issues, scores, routing history, audit log.
- CSV export: one-click downloads for any visible dataset.

## 14. Scoring File Compilation

The scoring job replaces `compile_internal_form`:

1. Load the cycle's scoring config.
2. Merge linked `HSPTResult` scaled scores (Reading, Math, Language, Science, Overall) for each applicant.
3. Merge essay scores.
4. Merge GPA composite (GPA, multiplier, GPA score, GPA bonus).
5. Apply DPSCD bonus and Marygrove bonus/catchment.
6. Compute `Total_App_Score` and `Total_MG_Score`.
7. Persist in `ScoreRecord`.
8. Write back to Submittable internal forms (`updateInternalForms`).
9. Compute percentile ranks for total, GPA, essay, exam, and exam subcomponent scores.
10. Export the scored dataset for use by the placement algorithm and external reports.

## 15. Placement Algorithm & Scenario Management

The placement algorithm assigns each applicant to the best available Exam High School based on ranked school choices, total application score, per-school capacity, and per-school cut scores. The algorithm uses a multi-pass sorting process:

1. Applicants are sorted by total application score in descending order.
2. The process runs multiple passes, alternating between the four main Exam High Schools and The School at Marygrove.
3. On each pass, a higher ranked choice is considered (First through Fifth).
4. A student is assigned to a school when:
   - It is the highest remaining ranked choice that still has available capacity,
   - The student's total score meets or exceeds the school's cut score,
   - Any school-specific minimum GPA or exam score requirements are satisfied.
5. Capacity is decremented as seats are filled.
6. The output includes the assigned school, the choice rank that produced the assignment (First through Fifth, or None if unassigned), and summary statistics.

Admissions staff define placement scenarios by entering the key variables for each school:

- **Capacity** — number of available seats per school.
- **Cut score** — minimum total score required for assignment to a school.
- **Minimum GPA / exam score** — optional additional thresholds for specific schools.

The app lets staff create and name multiple scenarios, run the algorithm against the compiled scoring file, compare summary tables, and export the resulting placement list. The compiled score records feed the placement algorithm, and the results are persisted for review. Percentile calculations and applicant results communications can be generated from the placement output if needed.

## 16. Catchment & Geocoding

- Address geocoding uses the Here API (API key stored as an environment variable).
- Catchment determination uses MongoDB `$geoIntersects` against a `catchment` GeoJSON collection.
- The legacy Azure Data API fallback for Marygrove is replaced by the direct MongoDB query.
- Results are stored on the submission or `ScoreRecord`.

## 17. Authorization & Audit Logging

- Authentication is binary: logged-in users have full access; logged-out users have none.
- Audit logs record who triggered jobs and configuration changes.

## 18. Security & Secrets

All credentials and secrets are environment variables:

- Submittable API key / Basic auth token
- MongoDB connection strings
- Here geocoding API key
- Microsoft Power Automate / Teams webhook URLs and signatures
- Starter auth email/password list (stored in `.env` until MSAL SSO is configured)

No secrets are hard-coded in source. Development uses `.env` files that are never committed.

## 19. Deployment

- Nuxt `nitro.preset: 'netlify'`.
- Background functions configured for long jobs.
- Deploy previews for pull requests.
- Environment variables configured in Netlify dashboard.
- MongoDB accessible from Netlify functions via allow-listed IPs or VPC peering as required.

## 20. Testing

- **Unit tests** (Vitest): age calculation, HSPT scoring, GPA point table, routing logic, duplicate detection, validation rules.
- **API tests** (nuxt/test-utils): job creation, metadata sync, CSV export.
- **Smoke tests**: run `extractMetadata` + `runValidation` against a Submittable sandbox and compare scoring output to known Python CSV output.

## 21. Project Roadmap

1. Bootstrap Nuxt 4 + Nuxt UI v4 + Mongoose project.
2. Build `Cycle`, `School`, `FormDefinition`, `ReviewStage` admin CRUD.
3. Implement Submittable API client and `extractMetadata` job.
4. Build the form-field mapping UI.
5. Implement `extractSubmissions`, `mapFields`, and `runValidation`.
6. Add dashboard and job runner UI.
7. Port scoring, routing, DSA audition compilation, and roster jobs.
8. Add tests and deploy to Netlify.

## 22. Open Questions & Risks

- MSAL SSO details (tenant, app registration, scopes) need to be confirmed for Phase 2.
- Existing MongoDB collections have ad-hoc shapes; a migration/import step may be needed.
- Submittable API rate limits and serverless timeouts require careful batching and retry logic.
- Placement scenarios must clearly show how changing capacity or cut scores affects assignments so staff can compare options before finalizing.
- Results communication workflow (percentile-based messaging) will be added after core placement is stable.
- Netlify background function implementation pattern (handler naming, `context.waitUntil`, or separate builders) must be validated against the chosen Netlify plan.

## 23. Reference Legacy Code

The new system is derived from the legacy scripts:

- `Submittable_v4.py` — the consolidated `Submittable` class containing API, extraction, scoring, routing, and export logic.
- `Submittable_Functions_v4.py` — the older module-level predecessor; most of its functionality was migrated into the `Submittable` class.
- `EHS_Automated.py` — the 2024-25 driver script that orchestrates extraction, routing, and CSV export for Application High Schools.
- `Sorting_Hat_2024.R` — the multi-pass school assignment algorithm that uses ranked choices, total scores, capacity, and cut scores.
- `Placement_Processing.R` — the orchestration script that runs placement scenarios, computes score percentiles, and prepares results communications.
- `HSPT Lookup/to_JS_Conversion.R` — parses raw STS CSV files and computes scaled HSPT scores.
- `HSPT Lookup/HSPT_Results.csv` — the previous processed HSPT results lookup table.
- `HSPT Lookup/index.html` — the previous read-only HSPT search interface.

These scripts are treated as the source-of-truth for business rules during the port but are not edited.