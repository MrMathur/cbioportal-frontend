import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    hasLanded,
    markNavigationStarted,
    noteSettledPage,
    waitForPageReady,
} from './navigationState';

const snapshot = (href: string, pageType?: string) => ({
    kind: 'snapshot' as const,
    at: '',
    pending: false,
    href,
    details: pageType ? { available: true, pageType } : { available: false },
});

const HOME = 'https://localhost:3000/';
const TO = '/study/summary?id=luad_tcga_pan_can_atlas_2018';

test('the old page under the new address has not landed', () => {
    // The address changes first; the host still describes the study list.
    assert.equal(
        hasLanded(
            snapshot(
                'https://localhost:3000/study/summary?id=luad_tcga_pan_can_atlas_2018',
                'studySelection'
            ),
            HOME,
            TO
        ),
        false
    );
});

test('the study page with the study open has landed', () => {
    assert.equal(
        hasLanded(
            snapshot(
                'https://localhost:3000/study/summary?id=luad_tcga_pan_can_atlas_2018#filterJson={}',
                'study'
            ),
            HOME,
            TO
        ),
        true
    );
    // Another study's page has not.
    assert.equal(
        hasLanded(
            snapshot(
                'https://localhost:3000/study/summary?id=brca_tcga',
                'study'
            ),
            HOME,
            TO
        ),
        false
    );
});

test('home, and paths without a page type', () => {
    assert.equal(
        hasLanded(
            snapshot(HOME, 'studySelection'),
            'https://localhost:3000/study?id=x',
            '/'
        ),
        true
    );
    assert.equal(
        hasLanded(snapshot('https://localhost:3000/news'), HOME, '/news'),
        true
    );
    assert.equal(hasLanded(snapshot(HOME, 'studySelection'), HOME, '/'), false);
});

test('a landed page is ready once its later reports stop', async () => {
    const study =
        'https://localhost:3000/study/summary?id=luad_tcga_pan_can_atlas_2018';
    markNavigationStarted(HOME, TO);
    const ready = waitForPageReady();
    noteSettledPage({ ...snapshot(study, 'study'), at: 'first' });
    // The charts arrive a moment after the first settled report.
    setTimeout(
        () => noteSettledPage({ ...snapshot(study, 'study'), at: 'full' }),
        50
    );
    const page = await ready;
    assert.equal(page?.at, 'full');
});
