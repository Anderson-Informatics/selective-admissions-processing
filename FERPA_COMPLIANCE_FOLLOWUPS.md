# FERPA Compliance — Operational Follow-ups

This document collects the compliance work that cannot be done inside the
application codebase. It covers the vendors, policies, contracts, and recurring
procedures needed to keep the EHS Admissions workspace defensible under FERPA.

> **Disclaimer.** This document is an operational guide, not legal advice.
> Have your district's counsel review any contract language and policy text
> before adoption.

---

## 1. Acronyms and terms

| Term | Definition |
| --- | --- |
| **FERPA** | Family Educational Rights and Privacy Act (20 U.S.C. § 1232g; 34 CFR Part 99). Federal law protecting the privacy of student *education records*. Applies to institutions that receive federal education funds. |
| **Education record** | Records directly related to a student and maintained by the school or a party acting for it. In this system: submissions, applicant PII, GPA records, HSPT scores, essay scores, addresses, review/routing status. |
| **PII** | Personally identifiable information — data that identifies a student directly (name, DOB, student number, address, parent contacts) or indirectly in combination. |
| **Directory information** | A narrow category FERPA allows schools to publish without consent if they give annual notice and opt-out rights. This app should not treat anything as directory information by default. |
| **School official exception** | 34 CFR § 99.31(a)(1)(i)(B) — lets a school share education records with contractors/vendors who perform an institutional function, *if* they are under the school's direct control regarding data use and maintenance, use the data only for the contracted purpose, and don't redisclose. This is the legal basis that makes vendor contracts (below) necessary. |
| **Legitimate educational interest** | The "need to know" standard — a school official may access records only to perform their job. Implemented in-app via the `site_admin`/`central_admin` roles; enforced operationally via access reviews. |
| **DPA** | Data Protection/Privacy Agreement — the contract addendum binding a vendor to FERPA-compatible handling of student data. |
| **NDPA** | National Data Privacy Agreement — the Student Data Privacy Consortium (SDPC) standard DPA template widely used between schools and ed-tech vendors. Preferred starting point over writing custom language. |
| **PTAC** | Privacy Technical Assistance Center — the U.S. Dept. of Education's free resource center (studentprivacy.ed.gov). Publishes model contract terms, checklists, and guidance. |
| **SOR** | System of record — the authoritative source for a record. Submittable is the SOR for applications; this app holds processing copies. |
| **RBAC** | Role-based access control — permissions granted by role (`site_admin`, `central_admin`) rather than per-person. |
| **MFA** | Multi-factor authentication — required on all administrative/control-plane accounts (Atlas, Netlify, GitHub, Submittable). |
| **SSO / MSAL / Entra ID** | Single sign-on; Microsoft Authentication Library; Microsoft Entra ID (formerly Azure AD). The planned future auth path — staff would sign in with district Microsoft accounts and roles could map from directory groups. |
| **TTL** | Time to live — automatic expiry. Used for invite/reset tokens (72 h / 24 h) and export files (7-day MongoDB TTL index). |
| **CSP / HSTS** | Content Security Policy / HTTP Strict Transport Security — browser security headers now set in `nuxt.config.ts` route rules. |
| **TLS** | Transport Layer Security — encryption in transit (HTTPS, TLS to MongoDB). |
| **IR / IRP** | Incident response / incident response plan — the procedure for handling a suspected data breach. |
| **SLA** | Service-level agreement — uptime/support terms; relevant when evaluating vendors but not itself a privacy clause. |
| **COPPA** | Children's Online Privacy Protection Act — governs online collection from children under 13. Generally not the operative law here (applicants are 8th-graders applying through a parent-facing system), but worth noting if younger students ever interact directly. |
| **PPRA** | Protection of Pupil Rights Amendment — surveys/sensitive-data collection rules; occasionally relevant to application forms. |
| **SIEM** | Security information and event management — centralized log tooling (optional; Atlas/Netlify logs + AuditLog collection may suffice at this scale). |

---

## 2. Vendor agreements (highest priority)

**Why.** Submittable, MongoDB Atlas, Netlify, HERE, and the registration-API
vendor all receive education records or PII. FERPA permits this only under the
school-official exception (§ 99.31(a)(1)(i)(B)) or with consent — which in
practice means a written contract for each vendor imposing direct control and
use/redisclosure limits.

**What to do for each vendor:**

1. Confirm a signed agreement exists covering student-data terms (many SaaS
   vendors provide a standard DPA).
2. Prefer the **SDPC National Data Privacy Agreement (NDPA)** where the vendor
   accepts it — it is the de-facto standard for ed-tech and most vendors already
   know it. Download the current version from the SDPC registry
   (privacy.a4l.org / studentdataprivacyconsortium.org).
3. Record the vendor in the inventory table below, with the contract location
   and renewal/review date.

### 2.1 Vendor inventory template

Keep this table in a shared ops document or compliance register:

| Vendor | Data received | Purpose | Contract type | Signed date | Review date | Contact | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Submittable | Full applications (all applicant + parent PII) | SOR for applications, reviews, messaging | | | | | System of record — likely already covered by district agreement |
| MongoDB Atlas | Copies of all records + audit logs | Database hosting | | | | | Confirm at-rest encryption + region |
| Netlify | App hosting, serverless execution, logs | Compute/edge | | | | | Verify log retention doesn't capture PII in request URLs |
| HERE Technologies | Student home addresses (geocoding) | Catchment determination | | | | | Address-only minimization already applied |
| Registration API vendor | Student registration/test records | Exam registration sync | | | | | |
| (Future) email provider | Staff emails only | Invite/reset delivery, if automated later | | | | | Not needed while links are manual |

### 2.2 Contract checklist (what a compliant DPA must say)

Whether using the NDPA or vendor paper, verify each of these points — they map
to FERPA requirements and PTAC model terms:

- [ ] **Purpose limitation:** vendor may use the data only to provide the
  contracted service to the school, and for no other purpose (no advertising,
  profiling, or product improvement unless de-identified and permitted).
- [ ] **Direct control:** the vendor is under the school's direct control with
  respect to use and maintenance of the education records.
- [ ] **No redisclosure:** no disclosure to third parties except authorized
  subcontractors bound to equivalent terms; vendor maintains a subcontractor
  list.
- [ ] **Data ownership:** the school/district owns the data; vendor claims no
  rights beyond the service.
- [ ] **Security:** reasonable administrative, technical, and physical
  safeguards; encryption in transit (and at rest for stored data); access
  limited to personnel with a need to know.
- [ ] **Breach notification:** vendor notifies the school within a defined
  window (recommend ≤ 72 hours) of any actual or reasonably suspected
  unauthorized disclosure, and cooperates on investigation/notification.
- [ ] **Return/destruction:** on termination or request, vendor returns and/or
  securely destroys the data within a defined period and certifies destruction.
- [ ] **Audit/assurance:** right to review security documentation (SOC 2 report,
  or completed security questionnaire) — recommend annually.
- [ ] **FERPA acknowledgment:** vendor agrees to comply with FERPA and any
  applicable state student-privacy law (for Michigan, check current state law —
  several states overlay stricter rules).
- [ ] **Access/correction support:** vendor assists the school in honoring
  parent requests for access/amendment within FERPA's 45-day window.

### 2.3 Where to get templates

- **SDPC NDPA** — studentdataprivacyconsortium.org (state-alliance version for
  Michigan if available).
- **PTAC model terms** — *Protecting Student Privacy While Using Online
  Educational Services* and contract-term checklists at studentprivacy.ed.gov.
- **CoSN / SETDA** privacy toolkits for vendor-evaluation workflows.

---

## 3. Data retention & destruction policy

**Why.** FERPA doesn't prescribe retention periods, but holding processing
copies forever expands breach exposure and makes § 99.32 disclosure records
harder to manage. Atlas backups, old job results, and legacy cycles all count.

**Recommended policy template** (adapt and adopt formally):

> ### EHS Admissions Processing — Data Retention
>
> 1. **Scope.** Records synced from Submittable and derived processing data:
>   submissions, mapped fields, reviews, GPA/HSPT records, scores, routing
>   history, job results, audit logs.
> 2. **Active cycle.** All data for the current admission cycle is retained in
>   full for the duration of the cycle plus the appeals/inquiry window
>   (recommended: through September 30 of the entry year).
> 3. **Post-cycle.** After the cycle closes, processing copies in MongoDB are
>   retained for **[N] years** (recommend 1–3, matching district records-retention
>   schedule) for reporting, then purged. Submittable remains the system of
>   record and retains the original applications per its own schedule.
> 4. **Exports.** Downloaded exports are staff responsibility — store only in
>   the district-managed drive, never personal devices. In-app export files
>   self-destruct after 7 days (already implemented via TTL).
> 5. **Audit logs.** `AuditLog` entries (including disclosure records required
>   by § 99.32) are retained **for as long as the underlying education records**
>   — i.e., purged together with the cycle, not before.
> 6. **Accounts.** Disabled user accounts are reviewed at the annual access
>   review and deleted after [1] year of inactivity. AuditLog entries naming
>   the account remain.
> 7. **Backups.** Atlas snapshot retention is set to [N] days; expired cycles
>   fall out of backups automatically within that window.
> 8. **Destruction.** Purges use database deletion plus backup aging-out. Paper
>   or exported copies are shredded/securely deleted. A destruction log is kept
>   (date, dataset, method, approver).
>
> Approval: ____________ Date: ______ Next review: ______ (annual)

**Action items:**
- [ ] Adopt the policy above with concrete `[N]` values from counsel/records officer.
- [ ] Schedule an annual purge job or manual run-book step (a small
  `pnpm`/script or admin endpoint can be added later if desired).
- [ ] Verify Atlas backup retention matches the policy.

---

## 4. Disclosure-log procedure (§ 99.32)

The app now records the required disclosures automatically:
`pii_export`, `data_api_disclosure`, `applicant_message_sent` entries in the
`AuditLog` collection, plus auth events (`user_invited`, `user_registered`,
`reset_link_created`, `account_locked`, `user_updated`).

**Ops procedure template:**

> 1. **Storage.** Disclosure records live in MongoDB `auditlogs`. Retained per
>   the retention policy above (as long as the education records).
> 2. **Parent requests.** If a parent requests the record of disclosures for a
>   student (a § 99.32 right), export matching entries:
>   `db.auditlogs.find({ entityId: '<submissionId>' })` or by `applicationId`/
>   `cycleId`. Provide to the parent's request handler within 45 days.
> 3. **Review.** At the quarterly access review (§ 5), spot-check
>   `pii_export` entries for unexpected exports and `data_api_disclosure` for
>   anomalous volume.

---

## 5. Access review procedure

**Cadence:** quarterly (or at minimum, each admissions cycle).

**Checklist template:**

> **Cycle ____ / Review date ____ / Reviewer (site admin): ________**
>
> - [ ] Export the user list from `/admin/users`; verify every account is a
>   current staff member.
> - [ ] Disable accounts for departed or transferred staff.
> - [ ] Confirm every `site_admin` account still needs admin rights — demote to
>   `central_admin` where not.
> - [ ] Confirm at least two active `site_admin` accounts (avoid single-admin lockout).
> - [ ] Revoke unused pending invitations.
> - [ ] Spot-check AuditLog `pii_export` and `data_api_disclosure` entries.
> - [ ] Verify `NUXT_DATA_KEY`/`NUXT_DATA_SECRET` still held only by the data
>   API consumer; rotate if stale or possibly exposed.
> - [ ] Rotate `NUXT_JOB_DISPATCH_SECRET` and session `NUXT_AUTH_SECRET` if any
>   suspicion of exposure (rotating auth secret logs everyone out).
>
> Findings: __________________  Actions taken: __________________

---

## 6. Incident response / breach notification plan (outline)

**Template skeleton** to adopt:

> 1. **Detection & report.** Any staff member who suspects unauthorized access
>   or disclosure reports immediately to [role: Data Protection Lead].
> 2. **Contain (0–24 h).** Disable affected user accounts (`/admin/users`),
>   revoke invite/reset tokens, rotate `NUXT_DATA_KEY`/`DATA_SECRET` if the
>   data API is implicated, rotate session/auth secrets, snapshot AuditLog
>   entries for forensics.
> 3. **Assess (24–72 h).** Determine which records and how many students were
>   affected; query `auditlogs` for the access/export timeline; preserve
>   Netlify/Atlas logs before they age out.
> 4. **Notify.** Per state breach law and district policy: affected
>   parents/students, district leadership, and where required, the vendor and
>   authorities. FERPA itself has no breach-notification mandate, but Michigan
>   law and contract DPAs typically do (check vendor DPA windows — usually
>   72 h both directions).
> 5. **Remediate & document.** Root cause, corrective actions, updated
>   controls. Log the incident and response in the compliance register.
> 6. **Post-incident review** within 30 days; update this plan and staff
>   training.

Contacts table to fill in: Data Protection Lead, IT lead, counsel,
communications, Atlas/Netlify/Submittable support lines.

---

## 7. Parent rights workflow (annual notification + requests)

This tool is staff-only; FERPA's parent-facing rights are handled upstream.
Document for staff reference:

> - **Annual notification** of FERPA rights is issued by the district's
>   registrar per standard process (not this app).
> - **Access requests:** parent requests to inspect records are fulfilled from
>   the system of record (Submittable) or the SIS. This app's data is derived;
>   direct requesters to the admissions office standard process.
> - **Amendment requests:** corrections are made in Submittable/SIS; this app
>   re-syncs via metadata/extraction jobs. Do not hand-edit mapped fields to
>   satisfy an amendment — fix the source and let sync propagate.
> - **Disclosure-log requests:** see § 4 — export from `auditlogs`.
> - All parent requests must be answered within **45 days** (§ 99.10).

---

## 8. Infrastructure hardening checklist

- [ ] MongoDB Atlas: encryption at rest enabled, TLS-only connections, IP
  allowlist (or PrivateLink) restricting to Netlify/known egress, least-
  privilege DB user (no admin rights), **MFA on the Atlas account**.
- [ ] Netlify: MFA + SSO on team accounts, environment variables limited to
  deploy-admin role, deploy log access reviewed, function log retention known.
- [ ] GitHub: MFA enforced at org level, branch protection on `main`,
  `.env` confirmed git-ignored (already), secrets-scanning enabled.
- [ ] Submittable: staff accounts use district SSO/MFA; API key scoped to the
  minimum project access and stored only as `NUXT_SUBMITTABLE_API_KEY`.
- [ ] Secrets rotation schedule documented (quarterly or on staff departure).
- [ ] `NUXT_BOOTSTRAP_ADMIN_*` removed from the environment after first
  successful admin creation (it's only needed when the users collection is
  empty — leaving a plaintext admin password in env is a standing risk).

---

## 9. Staff FERPA training (outline)

Annual 30–45 min session for everyone with an account:

1. What counts as an education record in this system.
2. Legitimate educational interest — look only at what your job needs.
3. Exports are disclosures: naming convention, where they may be stored, the
   7-day auto-expiry, and that downloads are audit-logged.
4. Invite/reset links are credentials — deliver via a trusted channel
   (never a public channel or applicant-facing message).
5. How to report a suspected breach (see § 6).
6. No screenshots/forwarding of applicant PII to personal email or devices.

Keep an attendance log — it doubles as evidence of administrative safeguards.

---

## 10. Roadmap note: MSAL SSO

When the Microsoft Entra ID (Azure AD) app registration is ready:

- Add `NUXT_MSAL_*` env vars (already reserved in `.env.example`).
- Sign-in flow: Entra ID handles password + MFA; the app keeps `User` records
  for role/status and maps Entra groups or a stored assignment to
  `site_admin`/`central_admin`.
- The local password path can then be disabled (env flag) or kept as
  break-glass for one site admin.
- Benefit: MFA and password policy move to district directory controls —
  a meaningful FERPA safeguard improvement.

---

## Summary — suggested order of operations

1. **This week:** vendor inventory + confirm/sign DPAs (esp. HERE — addresses are PII).
2. **This month:** adopt retention policy; run first access review; remove bootstrap env vars after seeding.
3. **This quarter:** incident-response plan + staff training session; verify Atlas/Netlify hardening checklist.
4. **Ongoing:** quarterly access reviews, annual policy/training refresh, vendor contract renewals tracked in the inventory.
