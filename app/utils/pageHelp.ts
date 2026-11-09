export interface PageHelpContent {
  title: string
  purpose: string
  tasks: string[]
  gettingStarted: string
  important: string[]
}

export const pageHelp = {
  dashboard: {
    title: 'Dashboard',
    purpose: 'Get an overview of admissions progress for one admission cycle. A cycle is the admissions period you are working on, such as a particular school year.',
    tasks: ['See how many submissions have been received, prepared for processing, and reviewed.', 'Compare progress across applications and review stages to see where work is waiting.', 'Check recent background work and outstanding data issues to decide what needs attention next.'],
    gettingStarted: 'Choose an admission cycle at the top of the page, then review the totals and application summaries. Use the navigation menu to open the page where you want to take action.',
    important: ['This is a summary of information already available in this system. Viewing the dashboard does not refresh data from Submittable or change submissions.', 'If information looks out of date, check the Jobs page for the latest data refresh and processing results.']
  },
  submissions: {
    title: 'Submissions',
    purpose: 'Find individual applicants and inspect the information this system has collected about their submissions.',
    tasks: ['Filter by admission cycle and application, or search for a submission.', 'Open a submission to review its details, prepared application fields, labels, and review information.', 'Run an address catchment lookup for a submission to check the school-area information available for it.'],
    gettingStarted: 'Select the cycle and, if needed, an application. Search for the applicant and open their submission to see more detail.',
    important: ['This page shows the information held by this system; it is not a replacement for the original application in Submittable.', 'An address lookup updates catchment information. It does not make an admissions decision.']
  },
  validation: {
    title: 'Data Validation',
    purpose: 'Find information that may be missing, inconsistent, or otherwise needs attention before it can be used confidently in admissions processing.',
    tasks: ['Filter issues by cycle, application, severity, and whether they are still open.', 'Search the issue list and read the explanation of each problem.', 'Mark an issue resolved after you have investigated and addressed it.'],
    gettingStarted: 'Choose a cycle and start with open errors, then review warnings and informational notices. Use the submission information to investigate the underlying problem.',
    important: ['Marking an issue resolved records that it has been dealt with; it does not correct the original application answer.', 'Use Run validation on the Jobs page to check the currently available information again.']
  },
  jobs: {
    title: 'Jobs',
    purpose: 'Start and monitor work that runs in the background, such as bringing in application information or checking it for problems.',
    tasks: ['Refresh the available projects, forms, stages, and labels from Submittable with Metadata sync.', 'Bring in submissions with Submission extraction, then prepare their answers for use throughout the app with Form response mapping.', 'Run data validation, address catchment lookups, or score compilation.', 'Refresh review completion for a cycle or application, and inspect job status, progress, results, and errors.'],
    gettingStarted: 'Choose the correct admission cycle before starting work. For initial setup, refresh metadata, configure applications and field mappings, then extract submissions and map their responses. Open a job’s details to check its outcome.',
    important: ['Starting work queues a background job; it may not finish immediately. Check for completion or errors before relying on its results.', 'The review-completion dry run evaluates the information without saving the completion records used by routing. Batch size controls how much work is processed together, not which applicants are eligible.']
  },
  scheduler: {
    title: 'Job Scheduler',
    purpose: 'Configure multiple daily chains of background jobs for the active admission cycle.',
    tasks: ['Create a named chain and select its Detroit-local time.', 'Select jobs and reorder them while preserving dependencies.', 'Monitor queued runs, inspect partial results and review held external actions.'],
    gettingStarted: 'Create a chain, select jobs, check the order and external-effect warnings, then enable and save. Mapping requires extraction; routing requires review-completion refresh. Catchment precedes validation when both are selected.',
    important: ['Chains queue in due order and run sequentially per cycle. Pausing does not cancel queued or active runs; manual jobs can still overlap.', 'Routing can be omitted. Live routing and essay workflows can modify Submittable submissions. Review external actions before releasing a hold.', 'Schedules use America/Detroit including DST, run once per local date, and do not replay missed prior days. Score compilation and uploaded-file jobs are not schedulable.']
  },
  essays: {
    title: 'Essays',
    purpose: 'Manage the essay-review workflow and follow reviewer progress for the selected admission cycle.',
    tasks: ['See essay review progress, reviewer activity, and scoring summaries.', 'Begin Scoring refreshes data, moves submissions with required unfinished essay reviews into the essay stage, and updates essay labels.', 'Update Scoring refreshes data and updates essay labels without moving submissions.', 'Finish Scoring refreshes data and labels, then moves submissions currently in the essay stage to their earliest required unfinished stage.', 'Download the available Excel export for the scoring job.'],
    gettingStarted: 'Select a cycle and check that an essay review stage is configured. Review the current progress before choosing a scoring action, and read its confirmation carefully.',
    important: ['Scoring actions run in the background and can update labels in Submittable. Begin Scoring and Finish Scoring can also move submissions between stages.', 'These controls manage the review workflow; they are not buttons for entering an individual reviewer’s essay score.']
  },
  hspt: {
    title: 'HSPT Upload & Matching',
    purpose: 'Bring High School Placement Test (HSPT) results into the system and connect each result to the correct applicant.',
    tasks: ['Upload one or more CSV result files, review the proposed import, and confirm it.', 'Search by name or date of birth and filter linked, unlinked, rejected, or needs-review results.', 'Inspect a suggested applicant match and accept or reject it, individually or for selected rows in Needs Review.', 'Search for an applicant to link manually, or remove an incorrect link.'],
    gettingStarted: 'Select the admission cycle, upload the CSV files, and review the preview before confirming. Then work through Needs Review and Unlinked results.',
    important: ['A suggested match is not proof that the test belongs to that applicant. Compare identifying details before accepting it.', 'Rejecting a match is about the test-to-applicant connection, not an admissions rejection. Confirming an import saves results; accepting or removing links changes which applicant those results belong to.']
  },
  gpa: {
    title: 'GPA Records',
    purpose: 'Review applicants’ grade point average (GPA) information from Opt-In schools and Detroit Public Schools Community District (DPSCD).',
    tasks: ['Filter records by admission cycle and information source.', 'Compare Opt-In GPA, DPSCD GPA, school, enrollment information, and available quarters.', 'Upload Opt-In school Excel files, inspect matched applicants and warnings, and confirm the import.', 'Check the status and summary of the latest DPSCD import.'],
    gettingStarted: 'Select a cycle. To add Opt-In grades, choose the school files and use Preview import. Check submission IDs, names, GPA values, and warnings before confirming.',
    important: ['Opt-In files are matched using Submission IDs. Only submissions represented in the files are updated.', 'Missing Opt-In labels, invalid grades, unmatched rows, and enrollment warnings need attention. A preview does not mean every row will be imported successfully.', 'This page uploads Opt-In files; the DPSCD section reports the latest DPSCD import rather than providing a DPSCD upload control.']
  },
  cycles: {
    title: 'Cycles',
    purpose: 'Organize admissions work into separate periods so that each year’s applications and processing can be managed together.',
    tasks: ['See existing cycles and which one is active.', 'Create a new cycle or edit an existing cycle’s name, year, dates, and active setting.', 'Clone a cycle as a starting point for another admissions period.', 'Delete a cycle when appropriate.'],
    gettingStarted: 'Check whether the admissions period already exists. Use New cycle for a fresh setup, or Clone to reuse an existing setup and enter the new cycle’s details.',
    important: ['The active cycle is used as the initial selection on many pages. Always verify the selected cycle before running work.', 'Cloning is a setup shortcut, not a fresh download of current Submittable information. Review the new cycle’s configuration before using it.', 'Treat deletion carefully and read the confirmation before proceeding.']
  },
  cycleNew: {
    title: 'New Cycle',
    purpose: 'Create a separate admissions period for a new year or intake.',
    tasks: ['Enter the year and a recognizable cycle name.', 'Set the cycle dates and choose whether this should be the active cycle.', 'Save the new cycle or cancel without creating it.'],
    gettingStarted: 'Enter a year and name that staff can distinguish from existing cycles. Check the dates and active setting, then create the cycle.',
    important: ['Creating a cycle does not by itself bring in submissions or configure all of its applications. Continue with Applications and Mappings before processing data.', 'Choose the active setting intentionally, since many pages initially select the active cycle.']
  },
  cycleEdit: {
    title: 'Edit Cycle',
    purpose: 'Update the identifying details and dates for an existing admissions period.',
    tasks: ['Change the cycle’s year, name, start date, or end date.', 'Make this the active cycle.', 'Save changes, cancel, or delete the cycle.'],
    gettingStarted: 'Check that you opened the intended cycle, adjust its details, and use Save changes to keep them.',
    important: ['These are cycle-wide settings. Application-specific admission rounds are configured on the application settings page instead.', 'Changing these details does not run data processing or move submissions in Submittable. Review the confirmation carefully before deleting a cycle.']
  },
  applications: {
    title: 'Applications & Review Stages',
    purpose: 'Connect Submittable projects to the applications used in an admission cycle and describe how their review stages fit into the admissions process.',
    tasks: ['Choose a cycle and see its configured applications.', 'Use Map project to connect an available Submittable project, name the application, and choose its type and active setting.', 'Edit application and review-stage settings, or use a built-in template as a starting point.', 'Open an application’s detailed settings to work on its routing rules and admission rounds.'],
    gettingStarted: 'Select a cycle and map the appropriate Submittable projects. If a project or stage is missing, run Metadata sync from Jobs, then return here.',
    important: ['Saving configuration here does not execute routing or change Submittable submissions.', 'Templates provide a starting point. Review all stage and field choices rather than assuming they fit your application.', 'Application setup and form-field mapping are different steps; use Mappings to tell the system how to interpret individual form answers.']
  },
  applicationDetail: {
    title: 'Application Settings',
    purpose: 'Define the review process for one application, including its admission rounds and the rules that determine how submissions move through stages.',
    tasks: ['Edit stage routing rules, required reviews, status labels, outcomes, and actions taken when entering or leaving a stage.', 'Use a built-in template or copy selected rules from another stage, then review any warnings.', 'Add and edit this application’s admission rounds, including names, dates, and active settings.', 'Save application settings, check whether draft changes have saved, discard the draft, or publish routing.'],
    gettingStarted: 'Select a stage to configure. Make changes in the draft and check the save status and warnings. Publish only when the rules are ready to be used, then go to Routing to preview their effect.',
    important: ['A draft is a working copy. Published routing is the version used when routing is run.', 'Publishing makes rules available for use; it does not itself execute routing or move submissions. Save settings is separate from publishing the routing draft.', 'Copied rules and templates may refer to fields that do not exist on the destination form. Resolve warnings before relying on them.']
  },
  mappings: {
    title: 'Form Field Mappings',
    purpose: 'Tell the system which questions on each application or review form contain the information it needs, even when different forms use different wording.',
    tasks: ['Choose a cycle and inspect its application and review forms.', 'See whether each form is fully mapped, partly mapped, or not mapped.', 'Open a form and connect its questions to the standard fields used by this system, then save the mapping.'],
    gettingStarted: 'Configure applications first. Select the cycle, open a form with missing mappings, and match each relevant question to the appropriate standard field.',
    important: ['Mapping describes how to interpret answers; it does not rewrite the original questions or applicants’ answers in Submittable.', 'After changing mappings, use Form response mapping on Jobs to prepare the stored answers again. Incorrect mappings can affect validation, scores, messages, and routing.']
  },
  templates: {
    title: 'Message Templates',
    purpose: 'Create reusable email messages for routing actions that open a submission for editing, so applicants receive clear and personalized instructions.',
    tasks: ['Create, edit, or delete templates with a name, description, subject, and message body.', 'Write visually or use the HTML view, and insert personalized values from submission or review answers.', 'Insert computed links and deadlines or use response libraries to turn selected answers into clear instructions.', 'Preview a message using a submission and send a test message to check the result.'],
    gettingStarted: 'Create or select a template, write the message, and insert personalized values using the available controls. Preview with a suitable submission and resolve missing-value warnings before using it in routing.',
    important: ['Saving a template does not send a message to applicants. Send test message does send an email to the test recipient you specify.', 'Check the subject, recipient, links, dates, and unresolved fields carefully. An example preview may not represent every applicant’s answers.', 'Changes to a reusable template can affect routing actions that use it.']
  },
  responseLibraries: {
    title: 'Response Libraries',
    purpose: 'Turn selected form answers into reusable, reader-friendly wording for message templates, such as turning a checklist of missing items into instructions for an applicant.',
    tasks: ['Create a library with a name, a unique reference key, and an optional description.', 'Add entries that pair an exact answer option with the text that should appear in a message.', 'Import options from a form field, then edit their replacement wording.', 'Save changes or delete a library, and reference it from a message template.'],
    gettingStarted: 'Create a library and add or import the answer options you want to translate. Write the message text for each option, save the library, and test it through a template preview.',
    important: ['Option labels must match the stored answers. Options without a matching entry are left out of the message.', 'Imported replacement text starts as the original option label; edit it into useful instructions before use.', 'A library does not change form answers or send messages by itself. Changes can affect every template that uses that library.']
  },
  routing: {
    title: 'Routing Preview',
    purpose: 'Check what the published review rules would do, then deliberately run them to move submissions and apply the configured actions.',
    tasks: ['Choose a cycle and optionally narrow the selection by application or label.', 'Preview a limited sample and inspect proposed stages, labels, and explanations.', 'Open a submission’s review completion details to understand which reviews are required and finished.', 'Queue a dry run for a limited selection or all matching submissions, or execute routing after checking the confirmation.'],
    gettingStarted: 'Publish the intended rules from the application settings first. Preview the selection, investigate unexpected results, and use a dry run before a live run when you need a broader check.',
    important: ['Preview is read-only and covers at most 500 submissions, not necessarily the whole application. Choose All matching submissions with a dry run to evaluate the full selection without writes to Submittable.', 'Live routing can write to Submittable, including moving stages and applying configured labels or messages. Check the scope and dry-run setting carefully.', 'Execution runs as a background job. Follow its progress and result on Jobs; a preview is not confirmation that a live run has completed.']
  },
  scoring: {
    title: 'Scoring Preview',
    purpose: 'Check what the score compilation would compute for an application using live data, before running it for real.',
    tasks: ['Choose a cycle and application, then run the preview.', 'Review readiness flags (HSPT, GPA, Essay), resolved GPA details, exam and essay scores, bonuses, both totals, and percentile ranks.', 'Search the results table to spot-check individual applicants.'],
    gettingStarted: 'Enable scoring and map the internal form on the application’s Scoring tab first. Then select the cycle and application here and run the preview.',
    important: ['The preview is read-only — nothing is written to the database, Submittable, or internal forms.', 'When the numbers look right, run Score compilation on the Jobs page to persist scores and write internal forms.']
  },
  login: {
    title: 'Sign In',
    purpose: 'Securely access the EHS Admissions workspace with your staff account.',
    tasks: ['Enter your account email address and password.', 'Sign in to open the admissions dashboard.', 'Correct your details and try again if the sign-in attempt is unsuccessful.'],
    gettingStarted: 'Use the email address and password supplied for your EHS Admissions account, then select Sign in.',
    important: ['This page does not create accounts or reset passwords. If you need access or cannot sign in, contact the person who manages staff access.', 'Keep your password private and sign out from the account menu when you finish using a shared computer.']
  }
} satisfies Record<string, PageHelpContent>

export type PageHelpKey = keyof typeof pageHelp
