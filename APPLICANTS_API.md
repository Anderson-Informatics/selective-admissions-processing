# Applicant Data API

This endpoint returns applicant information from stored submissions as paginated JSON or a downloadable CSV export. It is intended for authorized integrations that need to read applicant data without a user login.

## Access

- **Method and path:** `GET /api/data/applicants`
- **Authentication:** `Authorization: Bearer <DATA_KEY>`
- **Transport:** Use HTTPS. The API key grants access to personal information, including dates of birth and parent contact details. Do not place it in a query string, browser-side code, or logs.
- **Server setup:** Configure `NUXT_DATA_KEY` and `NUXT_DATA_SECRET` on the server. Give the caller only the value of `NUXT_DATA_KEY`; `NUXT_DATA_SECRET` is never sent in a request. Both settings are required for the endpoint to operate. See `.env.example`.
- A login session is **not** required. A valid API key is still required on every request.

Example request (set `DATA_KEY` securely in your shell first):

```sh
curl --fail-with-body \
  -H "Authorization: Bearer $DATA_KEY" \
  'https://YOUR_HOST/api/data/applicants?page=1&limit=100'
```

Replace `YOUR_HOST` with the deployed application's hostname. Do not share the key or use it from a public browser application.

To download all applicants as CSV:

```sh
curl --fail-with-body \
  -H "Authorization: Bearer $DATA_KEY" \
  -o applicants.csv \
  'https://YOUR_HOST/api/data/applicants?format=csv'
```

| Parameter | Meaning | Default |
| --- | --- | --- |
| `format` | `json` (paginated response) or `csv` (download all matching submissions). | `json` |

CSV uses the same fields and withdrawn-submission exclusion as JSON, with one header row and one row per applicant ordered by database ID. The response has `Content-Type: text/csv` and a download filename of `applicants.csv`. CSV ignores `page` and `limit`; it does not return a JSON envelope or `total`. Null fields become empty cells, dates use ISO 8601 UTC, and potentially executable spreadsheet formulas in text fields are prefixed with an apostrophe. In CSV only, `ParentPhone` values made up of 10 US digits (or 11 digits beginning with `1`) and ordinary phone punctuation are formatted as `(###) ###-####`; other values, including extensions and international numbers, retain their stored format and CSV safety handling. JSON phone values are unchanged. Import `StudentNumber` as text in spreadsheet programs to keep leading zeros. The export streams in batches, but is not a point-in-time snapshot: concurrent updates may change field values while it downloads.

## Pagination

| Parameter | Meaning | Default |
| --- | --- | --- |
| `page` | 1-based page number; positive integer. | `1` |
| `limit` | Records per page; integer from 1 to 100. | `100` |

The JSON response has `applicants` (an array), `total` (number of non-withdrawn submissions), `page`, and `limit`. To retrieve subsequent pages, increment `page` while keeping `limit` fixed. With an unchanged dataset, request pages 1 through `Math.ceil(total / limit)`; a page past the end returns an empty `applicants` array. Submissions from all cycles and applications are included, but those with status `withdrawn` (case-insensitive) are excluded from both `applicants` and `total`. There are no optional cycle, application, status, or date filters.

**Consistency caveat:** Pages use database-ID order with offset pagination, not a frozen snapshot. If submissions are added or removed during a multi-page download, page boundaries and `total` may change, so records could be duplicated or missed. Field values and related names can also change between requests. For a guaranteed point-in-time export, this endpoint would need a separate snapshot mechanism.

## Applicant fields

Every applicant object has the following keys. A missing value is `null`, except `submissionId`, which is required on stored submissions. Field names and capitalization are significant.

| Field | Source and meaning |
| --- | --- |
| `submissionId` | Submission identifier (string). |
| `submissionIdInt` | Numeric submission identifier, when available. |
| `submissionDate` | Submission's `completedAt` timestamp, serialized as an ISO 8601 UTC string when present; `null` otherwise. It does **not** use a mapped submission date. |
| `Application` | Name of the submission's Submittable project from synced project metadata; `null` if that project is not available in metadata. |
| `Year` | School-year string from the linked cycle's `year` field (for example, `2026-2027`); `null` if the cycle cannot be found. This is **not** the `cycleId` or a round key. |
| `StudentNumber` | Student number from mapped submission responses; preserve it as a string, including any leading zeros. |
| `FirstName` | Applicant first name from mapped responses. |
| `LastName` | Applicant last name from mapped responses. |
| `FullName` | Applicant full name from mapped responses. |
| `DOB` | Applicant date of birth from mapped responses; its representation depends on the mapped response data. |
| `ParentFirstName` | Parent/guardian first name from mapped responses. |
| `ParentLastName` | Parent/guardian last name from mapped responses. |
| `ParentPhone` | Parent/guardian phone number from mapped responses. |
| `ParentEmail` | Parent/guardian email address from mapped responses. |

Mapped response fields are returned as stored in JSON; only eligible CSV phone numbers are formatted as described above. No other submission or mapped-response fields are included.

Example response:

```json
{
  "applicants": [
    {
      "submissionId": "example-submission-1",
      "submissionIdInt": 42,
      "submissionDate": "2026-05-06T12:00:00.000Z",
      "Application": "High School Admissions",
      "Year": "2026-2027",
      "StudentNumber": "00123",
      "FirstName": "Ana",
      "LastName": "Lee",
      "FullName": "Ana Lee",
      "DOB": "2012-03-04",
      "ParentFirstName": "Pat",
      "ParentLastName": "Lee",
      "ParentPhone": "555-0100",
      "ParentEmail": "pat@example.test"
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 100
}
```

## Errors

| HTTP status | Meaning |
| --- | --- |
| `400` | Invalid `format`, or invalid `page` or `limit` for JSON. |
| `401` | Missing, incorrectly formatted, or invalid Bearer key. |
| `503` | The server is missing the API key or secret configuration. |
| `5xx` | Another server error, such as a database connection failure. |

Do not retry `401` or `503` by repeatedly sending the same request: correct the credentials or server configuration first.
