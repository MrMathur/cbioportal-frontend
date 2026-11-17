// Dispatches the current page store (currentPageStore.ts) to the
// get_page_details payload and the auto-sent context href.

import _ from 'lodash';
import { StudyViewPageStore } from 'pages/studyView/StudyViewPageStore';
import { StudyViewPageTabKeyEnum } from 'pages/studyView/StudyViewPageTabs';
import { ChartTypeEnum } from 'pages/studyView/StudyViewConfig';
import { ResultsViewPageStore } from 'pages/resultsView/ResultsViewPageStore';
import { USER_SETTINGS_QUERY_PARAM } from 'pages/resultsView/ResultsViewURLWrapper';
import GroupComparisonStore from 'pages/groupComparison/GroupComparisonStore';
import {
    getNumSamples,
    getNumPatients,
} from 'pages/groupComparison/GroupComparisonUtils';
import { PatientViewPageStore } from 'pages/patientView/clinicalInformation/PatientViewPageStore';
import { getCurrentPageStore } from './currentPageStore';

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
    // The numbers the dashboard's tables show. Frequencies are of the samples
    // profiled for that gene, not of the whole cohort.
    topMutatedGenes: StudyViewMutatedGene[];
    categoricalCharts: StudyViewCategoricalChart[];
    // Empty unless the Clinical Data tab is open.
    clinicalDataColumns: string[];
    // Genes picked in the query box or filtered on in a gene table.
    selectedGenes: string[];
    // Every other selection on the dashboard, one readable line each.
    activeFilters: string[];
}

interface StudyViewMutatedGene {
    gene: string;
    mutatedSamples: number;
    profiledSamples: number;
    frequencyPercent: number;
}

interface StudyViewCategoricalChart {
    uniqueKey: string;
    displayName: string;
    values: { value: string; count: number }[];
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
    | UnavailableDetails;

const MAX_MUTATED_GENES = 30;
const MAX_CATEGORIES_PER_CHART = 12;

function getTopMutatedGenes(store: StudyViewPageStore): StudyViewMutatedGene[] {
    const rows = store.mutatedGeneTableRowData.result ?? [];
    return _.take(
        _.orderBy(
            rows.filter(row => row.numberOfProfiledCases > 0),
            row => row.numberOfAlteredCases / row.numberOfProfiledCases,
            'desc'
        ),
        MAX_MUTATED_GENES
    ).map(row => ({
        gene: row.label,
        mutatedSamples: row.numberOfAlteredCases,
        profiledSamples: row.numberOfProfiledCases,
        frequencyPercent: _.round(
            (100 * row.numberOfAlteredCases) / row.numberOfProfiledCases,
            1
        ),
    }));
}

function getCategoricalCharts(
    store: StudyViewPageStore
): StudyViewCategoricalChart[] {
    return store.visibleAttributes
        .filter(chart => {
            const chartType = store.chartsType.get(chart.uniqueKey);
            return (
                chart.clinicalAttribute !== undefined &&
                (chartType === ChartTypeEnum.TABLE ||
                    chartType === ChartTypeEnum.PIE_CHART)
            );
        })
        .map(chart => ({
            uniqueKey: chart.uniqueKey,
            displayName: chart.displayName,
            values: _.take(
                store.getClinicalDataCount(chart).result ?? [],
                MAX_CATEGORIES_PER_CHART
            ).map(({ value, count }) => ({ value, count })),
        }));
}

function getClinicalDataColumns(store: StudyViewPageStore): string[] {
    if (store.currentTab !== StudyViewPageTabKeyEnum.CLINICAL_DATA) return [];
    return (store.clinicalAttributes.result ?? []).map(a => a.displayName);
}

function getSelectedGenes(store: StudyViewPageStore): string[] {
    const filteredGenes = store.geneFilters.flatMap(filter =>
        _.flattenDeep(filter.geneQueries).map(query => query.hugoGeneSymbol)
    );
    return _.uniq([...store.selectedGenes, ...filteredGenes]);
}

// Handled by getSelectedGenes or by the clinical labels below, or not a
// selection the user made on a chart.
const FILTERS_NOT_LISTED_AS_OTHER: readonly string[] = [
    'studyIds',
    'alterationFilter',
    'geneFilters',
    'clinicalDataFilters',
];

function isActiveFilter(value: unknown): boolean {
    if (Array.isArray(value)) return value.length > 0;
    const nested = (value as { filters?: unknown[] } | undefined)?.filters;
    return !!nested && nested.length > 0;
}

function describeValue(value: {
    value?: string;
    start?: number;
    end?: number;
}): string {
    return value.value ?? `${value.start ?? ''} to ${value.end ?? ''}`;
}

function getActiveFilters(store: StudyViewPageStore): string[] {
    const filters = store.filters;
    const attributes = _.keyBy(
        store.clinicalAttributes.result ?? [],
        a => a.clinicalAttributeId
    );
    const clinical = (filters.clinicalDataFilters ?? []).map(filter => {
        const name =
            attributes[filter.attributeId]?.displayName ?? filter.attributeId;
        return `${name}: ${filter.values.map(describeValue).join(', ')}`;
    });
    const other = Object.entries(filters)
        .filter(
            ([key, value]) =>
                !FILTERS_NOT_LISTED_AS_OTHER.includes(key) &&
                isActiveFilter(value)
        )
        .map(([key, value]) => `${_.startCase(key)}: ${JSON.stringify(value)}`);
    return [...clinical, ...other];
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
        topMutatedGenes: getTopMutatedGenes(store),
        categoricalCharts: getCategoricalCharts(store),
        clinicalDataColumns: getClinicalDataColumns(store),
        selectedGenes: getSelectedGenes(store),
        activeFilters: getActiveFilters(store),
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
