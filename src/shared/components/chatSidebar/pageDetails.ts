// Dispatches the current page store (currentPageStore.ts) to the
// get_page_details payload and the auto-sent context href.

import _ from 'lodash';
import { StudyViewPageStore } from 'pages/studyView/StudyViewPageStore';
import { ResultsViewPageStore } from 'pages/resultsView/ResultsViewPageStore';
import { USER_SETTINGS_QUERY_PARAM } from 'pages/resultsView/ResultsViewURLWrapper';
import GroupComparisonStore from 'pages/groupComparison/GroupComparisonStore';
import {
    getNumSamples,
    getNumPatients,
} from 'pages/groupComparison/GroupComparisonUtils';
import { PatientViewPageStore } from 'pages/patientView/clinicalInformation/PatientViewPageStore';
import { QueryStore } from 'shared/components/query/QueryStore';
import { getCurrentPageStore } from './currentPageStore';
import { HighlightTargetType } from './highlightStore';
import { getRegisteredTabs } from './tabRegistry';

// What the research-question highlights may point at on this page: the ids
// the chat iframe offers the model, and the only ones the host renders badges
// for.
export interface HighlightCandidate {
    targetType: HighlightTargetType;
    targetId: string;
    label: string;
    description?: string;
}

interface StudyViewVisibleChart {
    uniqueKey: string;
    displayName: string;
    dataType: string;
}

interface StudyViewDetails {
    available: true;
    pageType: 'study';
    currentTab: string;
    selectedSampleCount: number;
    selectedPatientCount: number;
    isFiltered: boolean;
    // Filters aren't repeated here — already in the auto-sent href
    // (getCurrentContextHref below) as #filterJson=...
    visibleCharts: StudyViewVisibleChart[];
    highlightCandidates: HighlightCandidate[];
}

interface ResultsViewDetails {
    available: true;
    pageType: 'results';
    currentTab: string;
    oqlText: string;
    hugoGeneSymbols: string[];
    caseSetId: string | undefined;
    sampleCount: number;
    patientCount: number;
    // Empty until customized — default tracks are computed client-side in
    // the OncoPrint component, not here.
    clinicalTrackAttributeIds: string[];
    // Raw heatmap_track_groups/generic_assay_groups URL params, unparsed.
    heatmapTrackGroups: string | undefined;
    genericAssayTrackGroups: string | undefined;
    highlightCandidates: HighlightCandidate[];
}

interface GroupComparisonGroupSummary {
    name: string;
    description: string;
    sampleCount: number;
    patientCount: number;
}

interface GroupComparisonDetails {
    available: true;
    pageType: 'groupComparison';
    groups: GroupComparisonGroupSummary[];
    highlightCandidates: HighlightCandidate[];
}

interface StudySelectionDetails {
    available: true;
    pageType: 'studySelection';
    selectedStudyIds: string[];
    // Every study in the list; the chat server narrows these to the question.
    highlightCandidates: HighlightCandidate[];
}

interface PatientViewDetails {
    available: true;
    pageType: 'patient';
    currentTab: string;
    pageMode: 'patient' | 'sample';
    // Set only when pageMode is 'sample' — the URL is scoped to one sample.
    sampleId: string | undefined;
    sampleCount: number;
    cancerType: string | undefined;
    timelineEventTypes: string[];
    // More than one id means panel coverage may differ across samples.
    genePanelIds: string[];
}

interface UnavailableDetails {
    available: false;
}

export type PageDetails =
    | StudyViewDetails
    | ResultsViewDetails
    | GroupComparisonDetails
    | PatientViewDetails
    | StudySelectionDetails
    | UnavailableDetails;

function getTabCandidates(
    targetType: 'results-tab' | 'comparison-tab'
): HighlightCandidate[] {
    return getRegisteredTabs(targetType).map(t => ({
        targetType,
        targetId: t.id,
        label: t.label,
    }));
}

const MAX_STUDY_DESCRIPTION_CHARS = 160;

function summarizeStudyDescription(html: string | undefined): string {
    const text = (html || '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return text.length > MAX_STUDY_DESCRIPTION_CHARS
        ? `${text.slice(0, MAX_STUDY_DESCRIPTION_CHARS)}…`
        : text;
}

function getStudySelectionDetails(store: QueryStore): StudySelectionDetails {
    return {
        available: true,
        pageType: 'studySelection',
        selectedStudyIds: store.selectableSelectedStudyIds,
        highlightCandidates: store.selectableStudies.map(study => ({
            targetType: 'study',
            targetId: study.studyId,
            label: study.name,
            description: [
                `cancer type: ${study.cancerTypeId}`,
                `${study.allSampleCount} samples`,
                summarizeStudyDescription(study.description),
            ]
                .filter(Boolean)
                .join('; '),
        })),
    };
}

function getStudyViewDetails(store: StudyViewPageStore): StudyViewDetails {
    return {
        available: true,
        pageType: 'study',
        currentTab: store.currentTab,
        selectedSampleCount: store.selectedSamples.result.length,
        selectedPatientCount: store.selectedPatients.length,
        isFiltered: store.chartsAreFiltered,
        visibleCharts: store.visibleAttributes.map(c => ({
            uniqueKey: c.uniqueKey,
            displayName: c.displayName,
            dataType: c.dataType,
        })),
        highlightCandidates: store.visibleAttributes.map(c => ({
            targetType: 'visualization',
            targetId: c.uniqueKey,
            label: c.displayName,
            description: `${c.dataType} chart`,
        })),
    };
}

function getResultsViewDetails(
    store: ResultsViewPageStore
): ResultsViewDetails {
    return {
        available: true,
        pageType: 'results',
        currentTab: store.tabId,
        oqlText: store.oqlText,
        hugoGeneSymbols: store.hugoGeneSymbols,
        caseSetId: store.urlWrapper.query.case_set_id,
        sampleCount: store.filteredSamples.result?.length ?? 0,
        patientCount: store.filteredPatients.result?.length ?? 0,
        clinicalTrackAttributeIds: (
            store.pageUserSession.userSettings?.clinicallist ?? []
        ).map(c => String(c.stableId)),
        heatmapTrackGroups: store.urlWrapper.query.heatmap_track_groups,
        genericAssayTrackGroups: store.urlWrapper.query.generic_assay_groups,
        highlightCandidates: getTabCandidates('results-tab'),
    };
}

function getGroupComparisonDetails(
    store: GroupComparisonStore
): GroupComparisonDetails {
    return {
        available: true,
        pageType: 'groupComparison',
        groups: (store.activeGroups.result ?? []).map(g => ({
            name: g.name,
            description: g.description,
            sampleCount: getNumSamples(g),
            patientCount: getNumPatients(g),
        })),
        highlightCandidates: getTabCandidates('comparison-tab'),
    };
}

function getPatientViewDetails(
    store: PatientViewPageStore
): PatientViewDetails {
    return {
        available: true,
        pageType: 'patient',
        currentTab: store.currentTab,
        pageMode: store.pageMode,
        sampleId: store.pageMode === 'sample' ? store.sampleId : undefined,
        sampleCount: store.sampleIds.length,
        cancerType: store.studyMetaData.result?.cancerType?.name,
        timelineEventTypes: _.uniq(
            (store.clinicalEvents.result ?? []).map(e => e.eventType)
        ),
        genePanelIds: _.uniq(
            Object.values(store.sampleToMutationGenePanelId.result)
        ),
    };
}

// A new Study View store has no study until updateStoreFromURL runs. Its chart
// list must not be read before then: that sends the chart-eligibility requests
// (treatments, clinical event types) with no study ids, which the API rejects.
function studyViewHasStudy(store: StudyViewPageStore): boolean {
    return (
        store.queriedPhysicalStudyIds.isComplete &&
        store.queriedPhysicalStudyIds.result.length > 0
    );
}

export function getCurrentPageDetails(): PageDetails {
    const store = getCurrentPageStore();
    if (store instanceof StudyViewPageStore) {
        return studyViewHasStudy(store)
            ? getStudyViewDetails(store)
            : { available: false };
    }
    if (store instanceof ResultsViewPageStore) {
        return getResultsViewDetails(store);
    }
    if (store instanceof GroupComparisonStore) {
        return getGroupComparisonDetails(store);
    }
    if (store instanceof PatientViewPageStore) {
        return getPatientViewDetails(store);
    }
    if (store instanceof QueryStore) {
        return getStudySelectionDetails(store);
    }
    return { available: false };
}

// True while the data behind getCurrentPageDetails() is still loading, so a
// snapshot taken now would describe a page the user never saw (e.g. Study
// View's 0 samples, 0 charts). Keep in step with the get*Details functions.
export function isCurrentPageDetailsPending(): boolean {
    const store = getCurrentPageStore();
    if (store instanceof StudyViewPageStore) {
        // loadingInitialDataForSummaryTab is false before the study ids
        // resolve, and the visible charts are only set once it turns false.
        return (
            !studyViewHasStudy(store) ||
            store.loadingInitialDataForSummaryTab ||
            store.selectedSamples.isPending
        );
    }
    if (store instanceof ResultsViewPageStore) {
        return (
            store.filteredSamples.isPending || store.filteredPatients.isPending
        );
    }
    if (store instanceof GroupComparisonStore) {
        return store.activeGroups.isPending;
    }
    if (store instanceof PatientViewPageStore) {
        return (
            store.studyMetaData.isPending ||
            store.clinicalEvents.isPending ||
            store.sampleToMutationGenePanelId.isPending
        );
    }
    if (store instanceof QueryStore) {
        return store.cancerStudies.isPending || store.cancerTypes.isPending;
    }
    return false;
}

// Mirrors StudyViewPage.tsx's bookmark-link formula — Study View never puts
// filters in the address bar otherwise.
function getStudyViewContextHref(store: StudyViewPageStore): string {
    return `${window.location.protocol}//${window.location.host}${
        window.location.pathname
    }${window.location.search}#filterJson=${JSON.stringify(store.filters)}`;
}

// Mirrors ShareUI.tsx's bookmark-link formula — adds the OncoPrint track
// selection the plain URL doesn't carry.
function getResultsViewContextHref(store: ResultsViewPageStore): string {
    const userSettings = store.pageUserSession.userSettings;
    if (!userSettings) {
        return window.location.href;
    }
    const url = new URL(window.location.href);
    url.hash = `${USER_SETTINGS_QUERY_PARAM}=${JSON.stringify(userSettings)}`;
    return url.toString();
}

// Page-agnostic to callers — always one string. Group Comparison isn't
// special-cased: its URL already round-trips full state.
export function getCurrentContextHref(): string {
    const store = getCurrentPageStore();
    if (store instanceof StudyViewPageStore) {
        return getStudyViewContextHref(store);
    }
    if (store instanceof ResultsViewPageStore) {
        return getResultsViewContextHref(store);
    }
    return window.location.href;
}
