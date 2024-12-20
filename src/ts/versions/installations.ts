import {satisfies} from 'semver';
import {has} from '@0cfg/utils-common/lib/has';
import {Exception} from '../utils/exceptions';
import {Helm} from '../plugins/Helm';
import {KubeApply} from '../plugins/KubeApply';
import {VersionedState} from '../Landscape';
import {Flow, VersionedValues} from '../flow/Flow';
import {KubeClient} from '../utils/KubeClient';
import {Installation as Installation_1_46} from './v1.46/installation';
import {Installation as Installation_1_47} from './v1.47/installation';
import {Installation as Installation_1_50} from './v1.50/installation';
import {Installation as Installation_1_51} from './v1.51/installation';
import {Installation as Installation_1_62} from './v1.62/installation';
import {Installation as Installation_1_74} from './v1.74/installation';
import {Installation as Installation_1_80} from './v1.80/installation';
import {Installation as Installation_1_81} from './v1.81/installation';
import {Installation as Installation_1_90} from './v1.90/installation';

export type InstallationConfig = {
    genDir: string,
    dryRun: boolean,
}

export interface InstallationState {
    store<S extends VersionedState, I extends VersionedValues>(stateValues: S, inputValues: I): Promise<void>;
}

export interface Installation {
    install(flow: Flow, stateValues: null | VersionedState, inputValues: VersionedValues): Promise<void>;
}

export interface InstallationConstructor {
    new (
        state: InstallationState,
        kubeClient: KubeClient,
        helm: Helm,
        kubeApply: KubeApply,
        config: InstallationConfig,
    ): Installation;
}

const versions: Record<string, InstallationConstructor> = {
    'v1.46.x': Installation_1_46,
    'v1.47.x': Installation_1_47,
    'v1.48.x': Installation_1_47,
    'v1.49.x': Installation_1_47,
    'v1.50.x': Installation_1_50,
    'v1.51.x': Installation_1_51,
    'v1.52.x': Installation_1_51,
    'v1.53.x': Installation_1_51,
    'v1.54.x': Installation_1_51,
    'v1.55.x': Installation_1_51,
    'v1.56.x': Installation_1_51,
    'v1.57.x': Installation_1_51,
    'v1.58.x': Installation_1_51,
    'v1.59.x': Installation_1_51,
    'v1.60.x': Installation_1_51,
    'v1.61.x': Installation_1_51,
    'v1.62.x': Installation_1_62,
    'v1.63.x': Installation_1_62,
    'v1.64.x': Installation_1_62,
    'v1.65.x': Installation_1_62,
    'v1.66.x': Installation_1_62,
    'v1.67.x': Installation_1_62,
    'v1.68.x': Installation_1_62,
    'v1.69.x': Installation_1_62,
    'v1.70.x': Installation_1_62,
    'v1.71.x': Installation_1_62,
    'v1.72.x': Installation_1_62,
    'v1.73.x': Installation_1_62,
    'v1.74.x': Installation_1_74,
    'v1.75.x': Installation_1_74,
    'v1.76.x': Installation_1_74,
    'v1.77.x': Installation_1_74,
    'v1.78.x': Installation_1_74,
    'v1.79.x': Installation_1_74,
    'v1.80.x': Installation_1_80,
    'v1.81.x': Installation_1_81,
    'v1.82.x': Installation_1_81,
    'v1.83.x': Installation_1_81,
    'v1.84.x': Installation_1_81,
    'v1.85.x': Installation_1_81,
    'v1.86.x': Installation_1_81,
    'v1.87.x': Installation_1_81,
    'v1.88.x': Installation_1_81,
    'v1.89.x': Installation_1_81,
    'v1.90.x': Installation_1_90,
    'v1.91.x': Installation_1_90,
    'v1.92.x': Installation_1_90,
    'v1.93.x': Installation_1_90,
    'v1.94.x': Installation_1_90,
    'v1.95.x': Installation_1_90,
};

export class VersionNotFound extends Exception {
    public constructor(version: string) {
        super(`Version ${version} not found`);
    }
}

/**
 * @throws VersionNotFound
 */
export const getInstallation = (version: string): InstallationConstructor => {
    const matchingVersion = Object.keys(versions).find(v => satisfies(version, v));
    if (!has(matchingVersion)) {
        throw new VersionNotFound(version);
    }
    return versions[matchingVersion];
};

/**
 * @throws VersionNotFound
 */
export const convertStateValues = (state: VersionedState, targetVersion: string): VersionedState => {
    const matchingVersion = Object.keys(versions).find(v => satisfies(state.version, v));
    if (!has(matchingVersion)) {
        throw new VersionNotFound(state.version);
    }
    // todo: think of conversion support
    return state;
};
