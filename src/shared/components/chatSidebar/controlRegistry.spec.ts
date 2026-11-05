import { assert } from 'chai';
import {
    getRegisteredControls,
    registerControl,
    unregisterControl,
} from './controlRegistry';

describe('controlRegistry', () => {
    it('keeps a control registered until its last instance unmounts', () => {
        registerControl('gene-query');
        registerControl('gene-query');
        unregisterControl('gene-query');
        assert.deepEqual(getRegisteredControls(), ['gene-query']);
        unregisterControl('gene-query');
        assert.deepEqual(getRegisteredControls(), []);
    });
});
