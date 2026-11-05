// What the portal holds, for the chat's request classification: the cancer
// type hierarchy and the study list, plus the clinical attributes, molecular
// profiles and cancer types of the studies on screen. Fetched with the
// portal's own API client on the iframe's request, so a private portal
// reports its own catalog.

import _ from 'lodash';
import client from 'shared/api/cbioportalClientInstance';
import internalClient from 'shared/api/cbioportalInternalClientInstance';
import {
    MolecularProfileFilter,
    StudyViewFilter,
} from 'cbioportal-ts-api-client';

export interface CatalogCancerType {
    id: string;
    name: string;
    // 'tissue' for top-level types.
    parent: string;
}

export interface CatalogStudy {
    studyId: string;
    name: string;
    cancerTypeId: string;
    sampleCount: number;
}

export interface Catalog {
    cancerTypes: CatalogCancerType[];
    studies: CatalogStudy[];
}

export interface StudyContext {
    studyIds: string[];
    clinicalAttributes: {
        id: string;
        name: string;
        patientAttribute: boolean;
        datatype: string;
    }[];
    molecularProfiles: {
        id: string;
        name: string;
        alterationType: string;
        studyId: string;
    }[];
    // Values of the CANCER_TYPE attribute in these studies, with sample
    // counts; empty when the studies don't have it.
    cancerTypes: { name: string; count: number }[];
}

let catalogPromise: Promise<Catalog> | undefined;

async function fetchCatalog(): Promise<Catalog> {
    const [cancerTypes, studies] = await Promise.all([
        client.getAllCancerTypesUsingGET({}),
        client.getAllStudiesUsingGET({ projection: 'SUMMARY' }),
    ]);
    return {
        cancerTypes: cancerTypes
            .filter(t => t.parent !== 'null')
            .map(t => ({
                id: t.cancerTypeId,
                name: t.name,
                parent: t.parent,
            })),
        studies: studies.map(s => ({
            studyId: s.studyId,
            name: s.name,
            cancerTypeId: s.cancerTypeId,
            sampleCount: s.allSampleCount,
        })),
    };
}

/** Fetched once per page load; a failure is retried on the next request. */
export function getCatalog(): Promise<Catalog> {
    if (!catalogPromise) {
        const promise = fetchCatalog();
        catalogPromise = promise;
        promise.catch(() => {
            if (catalogPromise === promise) catalogPromise = undefined;
        });
    }
    return catalogPromise;
}

const studyContexts = new Map<string, Promise<StudyContext>>();

async function fetchCancerTypeCounts(
    studyIds: string[]
): Promise<{ name: string; count: number }[]> {
    try {
        const items = await internalClient.fetchClinicalDataCountsUsingPOST({
            clinicalDataCountFilter: {
                attributes: [{ attributeId: 'CANCER_TYPE', values: [] }],
                studyViewFilter: { studyIds } as StudyViewFilter,
            },
        });
        return _.flatMap(items, item => item.counts)
            .filter(c => c.value && c.value !== 'NA')
            .map(c => ({ name: c.value, count: c.count }));
    } catch {
        // Studies without the attribute; the classification then treats the
        // study's own cancer type as its only one.
        return [];
    }
}

async function fetchStudyContext(studyIds: string[]): Promise<StudyContext> {
    const [attributes, profiles, cancerTypes] = await Promise.all([
        client.fetchClinicalAttributesUsingPOST({ studyIds }),
        client.fetchMolecularProfilesUsingPOST({
            molecularProfileFilter: { studyIds } as MolecularProfileFilter,
        }),
        fetchCancerTypeCounts(studyIds),
    ]);
    return {
        studyIds,
        clinicalAttributes: _.uniqBy(
            attributes,
            a => a.clinicalAttributeId
        ).map(a => ({
            id: a.clinicalAttributeId,
            name: a.displayName,
            patientAttribute: a.patientAttribute,
            datatype: a.datatype,
        })),
        molecularProfiles: profiles.map(p => ({
            id: p.molecularProfileId,
            name: p.name,
            alterationType: p.molecularAlterationType,
            studyId: p.studyId,
        })),
        cancerTypes,
    };
}

export function getStudyContext(studyIds: string[]): Promise<StudyContext> {
    const key = [...studyIds].sort().join(',');
    let promise = studyContexts.get(key);
    if (!promise) {
        promise = fetchStudyContext(studyIds);
        studyContexts.set(key, promise);
        const settled = promise;
        settled.catch(() => {
            if (studyContexts.get(key) === settled) studyContexts.delete(key);
        });
    }
    return promise;
}
