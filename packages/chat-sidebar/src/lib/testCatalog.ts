import { Catalog } from './catalogMatch';

// A small slice of the portal's catalog for tests: lung and breast types
// with their studies.
export const CATALOG: Catalog = {
    cancerTypes: [
        { id: 'lung', name: 'Lung', parent: 'tissue' },
        { id: 'nsclc', name: 'Non-Small Cell Lung Cancer', parent: 'lung' },
        { id: 'luad', name: 'Lung Adenocarcinoma', parent: 'nsclc' },
        { id: 'lusc', name: 'Lung Squamous Cell Carcinoma', parent: 'nsclc' },
        { id: 'sclc', name: 'Small Cell Lung Cancer', parent: 'lung' },
        { id: 'breast', name: 'Breast', parent: 'tissue' },
        { id: 'brca', name: 'Invasive Breast Carcinoma', parent: 'breast' },
        { id: 'idc', name: 'Breast Invasive Ductal Carcinoma', parent: 'brca' },
        { id: 'mbc', name: 'Metaplastic Breast Cancer', parent: 'breast' },
    ],
    studies: [
        {
            studyId: 'luad_tcga_pan_can_atlas_2018',
            name: 'Lung Adenocarcinoma (TCGA, PanCancer Atlas)',
            cancerTypeId: 'luad',
            sampleCount: 566,
        },
        {
            studyId: 'luad_broad',
            name: 'Lung Adenocarcinoma (Broad, Cell 2012)',
            cancerTypeId: 'luad',
            sampleCount: 183,
        },
        {
            studyId: 'lusc_tcga_pan_can_atlas_2018',
            name: 'Lung Squamous Cell Carcinoma (TCGA, PanCancer Atlas)',
            cancerTypeId: 'lusc',
            sampleCount: 487,
        },
        {
            studyId: 'sclc_ucologne_2015',
            name: 'Small Cell Lung Cancer (U Cologne, Nature 2015)',
            cancerTypeId: 'sclc',
            sampleCount: 120,
        },
        {
            studyId: 'brca_tcga_pan_can_atlas_2018',
            name: 'Breast Invasive Carcinoma (TCGA, PanCancer Atlas)',
            cancerTypeId: 'brca',
            sampleCount: 1084,
        },
        {
            studyId: 'brca_metabric',
            name: 'Breast Cancer (METABRIC, Nature 2012 & Nat Commun 2016)',
            cancerTypeId: 'brca',
            sampleCount: 2509,
        },
        {
            studyId: 'brca_igr_2015',
            name: 'Breast Cancer (IGR, 2015)',
            cancerTypeId: 'brca',
            sampleCount: 216,
        },
        {
            studyId: 'mbc_msk_2021',
            name: 'Metaplastic Breast Cancer (MSK, 2021)',
            cancerTypeId: 'mbc',
            sampleCount: 30,
        },
    ],
};
