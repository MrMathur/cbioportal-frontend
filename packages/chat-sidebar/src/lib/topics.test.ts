import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    Classification,
    CODEBOOK_VERSION,
    emptySlots,
    isClassification,
    Slots,
} from './classification';
import { templateQuestion } from './researchTemplate';
import {
    addQuestion,
    compactQuestions,
    findingFromReply,
    matchesSearch,
    QuestionEntry,
    relativeTime,
    updateLatestQuestion,
} from './topics';

function slots(values: Partial<Record<keyof Slots, string>>): Slots {
    const s = emptySlots();
    for (const [name, value] of Object.entries(values)) {
        s[name as keyof Slots] = {
            status: 'specified',
            value: value!,
            options: [],
            source: 'chat',
        };
    }
    return s;
}

function classification(
    message: string,
    move: Classification['move'],
    aim = `Aim for ${message}`
): Classification {
    return {
        codebook_version: CODEBOOK_VERSION,
        request_type: 'data',
        oos_subtype: null,
        goal: 'describe',
        slots: emptySlots(),
        needs_groups: false,
        core_slots: ['cohort', 'entity', 'measure'],
        level: 'L2',
        guidance_degree: 'directing',
        multi_part: false,
        answerability: 'ui',
        move,
        drafts: {
            broad_aim: aim,
            working_question: `${message}?`,
            concrete_analysis: '',
        },
        rationale: '',
        checks: [],
        message,
    };
}

test('isClassification checks the codebook version', () => {
    assert.ok(isClassification(classification('q', null)));
    assert.ok(
        !isClassification({ ...classification('q', null), codebook_version: 4 })
    );
});

test('templateQuestion fills each goal and marks gaps', () => {
    assert.equal(
        templateQuestion(
            'describe',
            slots({
                entity: 'KRAS',
                measure: 'mutation frequency',
                cohort: 'lung adenocarcinoma',
            })
        ),
        'What is the mutation frequency of KRAS in lung adenocarcinoma?'
    );
    assert.equal(
        templateQuestion(
            'confirm',
            slots({
                entity: 'KRAS mutation',
                measure: 'worse overall survival',
                cohort: 'lung adenocarcinoma',
                study: 'TCGA LUAD',
                filter: 'sex: female',
            })
        ),
        'Is KRAS mutation associated with worse overall survival in lung adenocarcinoma (TCGA LUAD), restricted to sex: female?'
    );
    assert.equal(
        templateQuestion(
            'explain',
            slots({
                entity: 'TP53',
                measure: 'overall survival',
                groups: 'by subtype',
                cohort: 'whole study',
            })
        ),
        'How does overall survival differ for TP53 by subtype in the selected study?'
    );
    assert.equal(
        templateQuestion('describe', emptySlots()),
        'What is the [what to learn?] of [which gene or attribute?] in [which cohort?]?'
    );
});

test('a new move starts a topic; refinements join the current one', () => {
    let topics = addQuestion(
        [],
        classification('KRAS in lung', null),
        undefined
    ).topics;
    assert.equal(topics.length, 1);
    assert.equal(topics[0].questions[0].move, 'start');

    const refined = addQuestion(
        topics,
        classification('KRAS in female LUAD', 'refine'),
        undefined
    );
    assert.equal(refined.started, undefined);
    topics = refined.topics;
    topics = addQuestion(
        topics,
        classification('by race', 'sibling'),
        undefined
    ).topics;
    assert.equal(topics.length, 1);
    assert.deepEqual(
        topics[0].questions.map(q => q.move),
        ['start', 'refine', 'sibling']
    );

    const fresh = addQuestion(
        topics,
        classification('TP53 in breast', 'new', 'Understand TP53 in breast'),
        undefined
    );
    assert.ok(fresh.started);
    assert.equal(fresh.topics.length, 2);
    assert.equal(fresh.topics[0].title, 'Understand TP53 in breast');
    assert.equal(fresh.topics[1].questions.length, 3);
});

test('updateLatestQuestion patches only the newest entry', () => {
    let topics = addQuestion([], classification('a', null), 'href-a').topics;
    topics = addQuestion(topics, classification('b', 'refine'), 'href-b')
        .topics;
    const updated = updateLatestQuestion(topics, {
        href: 'href-b2',
        finding: 'Found.',
    });
    assert.equal(updated[0].questions[0].href, 'href-a');
    assert.equal(updated[0].questions[1].href, 'href-b2');
    assert.equal(updated[0].questions[1].finding, 'Found.');
    // Unchanged patches keep the same topic object.
    const same = updateLatestQuestion(updated, { href: 'href-b2' });
    assert.equal(same[0], updated[0]);
});

test('compactQuestions keeps the first and latest three', () => {
    const entries = Array.from({ length: 7 }, (_, i) => ({
        id: String(i),
    })) as QuestionEntry[];
    const { shown, hiddenCount } = compactQuestions(entries);
    assert.deepEqual(
        shown.map(e => e.id),
        ['0', '4', '5', '6']
    );
    assert.equal(hiddenCount, 3);
    assert.equal(compactQuestions(entries.slice(0, 4)).hiddenCount, 0);
});

test('matchesSearch looks at titles, questions and findings', () => {
    const { topics } = addQuestion(
        [],
        classification('KRAS in lung', null, 'Understand KRAS'),
        undefined
    );
    assert.ok(matchesSearch(topics[0], 'kras'));
    assert.ok(matchesSearch(topics[0], ''));
    assert.ok(!matchesSearch(topics[0], 'brca'));
});

test('findingFromReply takes the first prose sentence', () => {
    assert.equal(
        findingFromReply(
            '## Results\n\n**KRAS** is mutated in [32%](https://x) of samples. More text here.'
        ),
        'KRAS is mutated in 32% of samples.'
    );
    assert.equal(findingFromReply('```sql\nSELECT 1\n```'), undefined);
});

test('relativeTime is compact', () => {
    const now = new Date('2026-11-03T12:00:00Z');
    assert.equal(relativeTime('2026-11-03T11:59:30Z', now), 'just now');
    assert.equal(relativeTime('2026-11-03T11:45:00Z', now), '15 min ago');
    assert.equal(relativeTime('2026-11-03T09:00:00Z', now), '3 h ago');
    assert.equal(relativeTime('2026-11-02T10:00:00Z', now), 'yesterday');
});
