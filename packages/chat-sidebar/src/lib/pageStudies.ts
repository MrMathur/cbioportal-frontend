// Which studies a portal page is about, read from its URL.

function splitIds(value: string | null): string[] {
    return (value ?? '')
        .split(/[,+\s]+/)
        .map(id => id.trim())
        .filter(Boolean);
}

export function studyIdsFromHref(href: string): string[] {
    let url: URL;
    try {
        url = new URL(href);
    } catch {
        return [];
    }
    const params = url.searchParams;
    const path = url.pathname;
    if (/\/study(\/|$)/.test(path)) {
        return splitIds(params.get('id') ?? params.get('studyId'));
    }
    if (/\/results(\/|$)/.test(path)) {
        return splitIds(
            params.get('cancer_study_list') ?? params.get('cancer_study_id')
        );
    }
    if (/\/patient(\/|$)/.test(path)) {
        return splitIds(params.get('studyId'));
    }
    return [];
}
