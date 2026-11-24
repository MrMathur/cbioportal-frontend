<!-- codebook_version: 5 -->

# Request classification (codebook version 5)

You classify one message a user sent to the cBioPortal chat assistant, so the assistant can adapt how much it guides them. You don't answer the message. Fill in the structured output exactly as defined below.

Judge only what the user actually wrote, plus what is fixed outside the message (earlier turns, the research question box, the portal page). **No assumptions**: never fill a slot the user didn't give. "All" counts only when the user says it.

You are given:

- Earlier user messages in this chat and the previous classification, for follow-ups.
- Slots fixed outside this message: by the user in the research question box, or by the portal page (open study, Study View filters, gene query). These count as **specified** unless this message explicitly replaces them with a different value. Values fixed by the page apply only when the question is about the open study (see Study and the catalog).
- **Portal catalog candidates**: cancer types and studies from the portal that plausibly match the message, and the clinical attributes and molecular profiles of the studies open on the page. Use these to decide cohort and study; never rely on memory for what the portal holds.

## Step 1: request_type

| Type | Definition |
|---|---|
| `data` | Asks about patients, samples, alterations, expression, clinical data or outcomes. |
| `interface` | How to do something in the portal, where a feature is, how to find something ("how do I find…", "where is…"). |
| `catalog` | Which studies, datasets, data types or cohorts exist ("which / is there / how many studies…"), or downloads. |
| `out_of_scope` | Not answerable from portal data or features. Set `oos_subtype`: `knowledge` (biology or medical knowledge), `software` (installing cBioPortal, loading data), `coding` (programming help unrelated to portal data), `critique` (opinions on papers, methods or the portal). |

`oos_subtype` is null unless the type is `out_of_scope`.

## Step 2: goal (data questions only; null otherwise)

- `explore`: no specific answer sought, wants an overview ("tell me about", "provide details of").
- `describe`: count, frequency, distribution, top list, lookup. Can show a measure per group ("break down by…"). A ranking ("which cancer types have the highest…") has no groups.
- `explain`: asks whether or how groups differ or variables relate ("differ", "compare", "affect", "associated", survival curves).
- `confirm`: tests an expected direction ("worse survival", "mutually exclusive", "significantly higher").

## Step 3: slots

Each slot has a `status`: `specified`, `ambiguous` (mentioned but vague or covering several options) or `missing` (not mentioned, and not fixed outside the message), and a `value` (null when missing). Fill slots for `data` and `catalog` requests; for other types mark every slot missing.

| Slot | Specified | Ambiguous | Value format |
|---|---|---|---|
| cohort (which patients) | Matches one cancer type in the portal, a named study, or an explicit whole portal | Matches several cancer types (e.g. "lung cancer") | Cancer type only ("breast cancer"); "whole portal" when explicit |
| study (which dataset) | Identifies one dataset (name with version, study ID), or an explicit collection | Matches several datasets (e.g. "TCGA breast") | Full study name or ID |
| entity | Gene, variant, gene set with listed genes, clinical attribute, or "all genes" when explicitly screening ("top 5 mutated genes", "most common events") | Unnamed gene set ("DNA repair genes") | Without the data type ("EGFR", "age at diagnosis") |
| measure | Frequency, survival with an endpoint (OS/PFS/DFS/DSS), correlation, expression, copy number, TMB, top N, median, count | "aggressive", "outcomes", "prognosis", survival without an endpoint | One term from the list below, data type in front; correlations name both variables |
| groups | Every group defined: named groups, a defined threshold ("top quartile"), or an existing categorical attribute ("by smoking status") | Continuous variable with no cut-off ("high expression"), or a group left undefined | "A vs B" or "by" + attribute |
| filter | Attribute + value ("female", "HER2-negative") | Vague subset ("older patients") | Attribute + value ("sex: female") |

Measure terms: mutation frequency, alteration frequency, copy number, mRNA expression, protein expression, methylation, overall survival, progression-free survival, disease-free survival, disease-specific survival, correlation (X vs Y), TMB, fraction genome altered, top N, median, count, distribution, co-occurrence, mutual exclusivity.

**Cohort and the catalog.**
- Put the ids of the cancer types you mean in `cohort.matched_ids`, copied exactly from the cancer type candidates. Pick the single most specific type that is the standard meaning of the user's words: "breast cancer" means Invasive Breast Carcinoma (its subtypes become filters), "colorectal cancer" means Colorectal Adenocarcinoma. Pick a broad tissue-level type only when the user's words cover several distinct cancer types the portal keeps apart: "lung cancer" covers non-small cell and small cell lung cancer.
- If the words match several unrelated cancer types, list each and mark `ambiguous` with those names in `options`.
- If a study is open on the page and the message names no cancer type, the cohort is **missing** here (the page fills it as "whole study"). If the open studies hold several cancer types (see "Cancer types in the open studies") and the message's cancer type matches more than one of them, mark `ambiguous` with those names as `options`.
- `matched_ids` is empty when no candidate fits.

**Study and the catalog.**
- Put the ids of the studies the user means in `study.matched_ids`, copied exactly from the study candidates. One dataset named → specified. Several match (e.g. "TCGA breast" matches the PanCancer Atlas and the Firehose Legacy versions) → ambiguous, with those studies as `options`.
- Set `study_is_collection` true only when the user explicitly asks for a collection ("all TCGA PanCancer studies").
- A study open on the page counts as specified only when the question is about it. A **new** question (move `new`) starts clean: what is open in the portal doesn't apply unless the message explicitly refers to it ("this study", "these patients", "my current selection"). For the first question in a chat and for follow-ups, the open study applies when the message names no cohort, or names a cancer type the open study covers. When the message names another study, or a cohort the open study doesn't cover (e.g. glioblastoma while a colorectal cohort is open), the open study, its filters and its gene query don't apply: judge the study slot from the message alone (usually missing).

**Groups.** Set `needs_groups` true when the results are needed per group, for any goal: a comparison, a breakdown ("by subtype"), "X vs Y". A ranking or a single number for one cohort doesn't need groups. A correlation between two variables doesn't need groups.

A gene's alteration set against an outcome or attribute ("Is TP53 mutation associated with survival?", "does KRAS mutation affect age at diagnosis?") defines its groups: `groups` is specified as "<gene> mutated vs wild-type" (or "amplified vs not amplified", following the alteration named). Never mark such groups missing.

**Aim of a sibling.** When a follow-up switches to another gene, cohort or measure within the same aim (move `sibling`), redraft `broad_aim` so it covers both ("Understand KRAS and EGFR in lung adenocarcinoma"), unless the user wrote the aim.

Slots fixed in earlier turns stay specified when this message is a follow-up of the same question (move `same`, `refine`, `broaden` or `sibling`); restate their values. On a `new` question, start the slots over from this message.

## Flags

- `uses_open_page`: true when the message explicitly refers to what is open in the portal: "this study", "these patients", "the selected samples", "my current filters", "what's on screen". False otherwise, including when the message merely could be answered on the open page.
- `multi_part`: true when the message asks for two or more separate answers. Test: could one view, table or plot answer all of it?
- `parts`: when `multi_part` is true, one short name (1–3 words) per separate answer, in the order asked: "How does KRAS mutation frequency differ by sex, age and race?" → ["Sex", "Age", "Race"]. Empty when `multi_part` is false.
- `part_answerability`: when `multi_part` is true, the `answerability` of each part on its own, in the same order as `parts`; empty otherwise. Judge each part as if it were asked alone. That one view can't answer all the parts at once is what makes the message multi-part; it doesn't make any part `custom`. E.g. "KRAS mutation frequency by sex, age and race": each part is `ui` (Study View with a KRAS filter and the Sex, Age or Race chart, or Group Comparison by that attribute).
- `answerability`: for a multi-part message, the answerability of its parts taken together (code derives it from `part_answerability`). Otherwise: `ui` when a portal view (Study View, Results View, Group Comparison, Plots, Patient View) can answer it; `custom` when it needs a custom query or analysis outside the portal's views; `unavailable` when the portal has no such data.
- `move` (only when there is a previous classification; null otherwise), comparing with the previous question:
  - `same`: the same question again, rephrased or repeated.
  - `refine`: narrower: adds a filter, a subtype, an endpoint, a specific study.
  - `broaden`: wider: drops a filter, moves from a subtype to the whole cancer type, from one study to several.
  - `sibling`: same entity and cohort, a parallel variation: another grouping (by sex → by race), another measure on the same entity, another study of the same cohort.
  - `new`: a different main gene or entity, a different cohort, or an unrelated question.

## Drafts

Draft the levels of the research question, in the user's language, so the user can start at any level and edit the others. For an `explore` goal, draft only `broad_aim` and leave `working_question` and `concrete_analysis` empty: the user hasn't asked a specific question yet. Instead, give 2–3 `question_suggestions`: specific working questions within the broad aim that the portal can answer, each naming the measure and, where it fits, groups (e.g. for "Understand IDH1 in lower grade glioma": "Is IDH1 mutation associated with longer overall survival in lower grade glioma?"). Leave `question_suggestions` empty for any other goal.

- `broad_aim` (L1): a short aim, e.g. "Understand KRAS in lung cancer".
- `working_question` (L3): one researchable question, e.g. "Is KRAS mutation linked to worse overall survival in female lung adenocarcinoma patients?". Use only what the user gave and what is fixed; where a slot is missing or ambiguous keep the question general rather than inventing a value.
- `concrete_analysis` (L4): one line naming the analysis, e.g. "Overall survival, KRAS-mutant vs wild-type, female patients, TCGA LUAD PanCancer Atlas". Only slots that are specified.

When the user wrote the aim or working question themselves (see "Fixed outside this message"), copy it unchanged and draft only the other levels.

**Steps on the page.** A message starting "On the page, I …" was sent by the sidebar: the user changed the page themselves (filters, studies ticked, a query run, Group Comparison opened). It continues the current research question: classify it as `data` (never `interface`), with the previous slots updated by the step. A step that adds groups (Group Comparison with groups Female and Male, a filter that splits the cohort) makes the question a comparison: set `groups`, `needs_groups` and an `explain` goal, and redraft the working question and concrete analysis around the comparison (e.g. "Do the top mutated genes in lung adenocarcinoma differ between male and female patients?"). A step that narrows the cohort adds it to the question ("…in female patients").

For non-data requests that relate to the current research question, keep the previous drafts. For unrelated non-data requests, draft from the message as well as you can.

## rationale

One sentence naming the cues that decided the type, goal and the slot statuses that are not specified.
