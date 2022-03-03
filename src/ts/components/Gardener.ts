import path from 'path';
import IPCIDR from 'ip-cidr';
import {Task} from '../flow/Flow';
import {createLogger} from '../log/Logger';
import {Chart, Helm, RemoteChartFromZip, Values} from '../plugins/Helm';
import {KubeClient} from '../utils/KubeClient';
import {trimPrefix} from '../utils/trimPrefix';
import {GardenerNamespace, GeneralValues} from '../Values';
import {CA, createClientTLS, createSelfSignedCA, defaultExtensions, TLS} from '../utils/tls';
import {getKubeConfigForServiceAccount, serviceHosts} from '../utils/kubernetes';
import {deepMergeObject} from '../utils/deepMerge';
import {waitUntilVirtualClusterIsReady} from './VirtualCluster';

const log = createLogger('Gardener');

export const GardenerVersion = 'v1.41.1';
export const GardenerRepoZipUrl = `https://github.com/gardener/gardener/archive/refs/tags/${GardenerVersion}.zip`;
export const GardenerChartsBasePath = `gardener-${trimPrefix(GardenerVersion, 'v')}/charts/gardener`;
export const GardenerChartBasePath = path.join(GardenerChartsBasePath, 'controlplane/charts');

export interface GardenerCertificates {
    ca: CA,
    apiserver: TLS,
    controllerManager: TLS,
    admissionController: TLS,
}

const defaultResources = {
    'apiserver': {
        'limits': {
            'cpu': '300m',
            'memory': '256Mi',
        },
        'requests': {
            'cpu': '100m',
            'memory': '100Mi',
        },
    },
    'admission': {
        'requests': {
            'cpu': '100m',
            'memory': '200Mi',
        },
        'limits': {
            'cpu': '300m',
            'memory': '512Mi',
        },
    },
    'controller': {
        'limits': {
            'cpu': '750m',
            'memory': '512Mi',
        },
        'requests': {
            'cpu': '100m',
            'memory': '100Mi',
        },
    },
    'scheduler': {
        'limits': {
            'cpu': '300m',
            'memory': '256Mi',
        },
        'requests': {
            'cpu': '50m',
            'memory': '50Mi',
        },
    },
};

export class Gardener extends Task {

    private virtualClient?: KubeClient;

    constructor(
        private readonly hostClient: KubeClient,
        private readonly helm: Helm,
        private readonly values: GeneralValues,
        private readonly dryRun: boolean,
    ) {
        super('Gardener');
    }

    public async do(): Promise<void> {
        log.info(`Installing Gardener version ${GardenerVersion}`);
        if (!this.dryRun) {
            this.virtualClient = await waitUntilVirtualClusterIsReady(log, this.values);
        }

        log.info('Install Gardener Controlplane');

        const gardenerValues = this.getValues();

        const applicationHelmChart = new ApplicationChart(gardenerValues);
        await this.helm.createOrUpdate(await applicationHelmChart.getRelease(this.values), this.virtualClient?.getKubeConfig());

        gardenerValues.global.apiserver.kubeconfig = await this.getKubeConfigForServiceAccount('gardener-apiserver');
        gardenerValues.global.controller.kubeconfig = await this.getKubeConfigForServiceAccount('gardener-controller-manager');
        gardenerValues.global.scheduler.kubeconfig = await this.getKubeConfigForServiceAccount('gardener-scheduler');
        gardenerValues.global.admission.kubeconfig = await this.getKubeConfigForServiceAccount('gardener-admission-controller');

        const runtimeHelmChart = new RuntimeChart(gardenerValues);
        await this.helm.createOrUpdate(await runtimeHelmChart.getRelease(this.values));
    }

    private getValues() {
        return {
            global: {
                apiserver: this.apiserverValues(),
                controller: this.controllerValues(),
                admission: this.admissionValues(),
                scheduler: this.schedulerValues(),
                defaultDomains: [{
                    domain: `${this.values.gardener.shootDomainPrefix}.${this.values.host}`,
                    provider: this.values.dns.provider,
                    credentials: this.values.dns.credentials,
                }],
                internalDomains: {
                    domain: `internal.${this.values.host}`,
                    provider: this.values.dns.provider,
                    credentials: this.values.dns.credentials,
                },
                deployment: {
                    virtualGarden: {
                        enabled: true,
                        clusterIP: new IPCIDR(this.values.hostCluster.network.serviceCIDR).toArray()[20],
                    },
                },
            },
        };
    }

    private apiserverValues() {
        return deepMergeObject({
            enabled: true,
            clusterIdentity: this.values.landscapeName,
            kubeconfig: 'dummy', // need to be set for the runtime chart
            image: {
                tag: GardenerVersion,
            },
            caBundle: this.values.gardener.certs.ca.cert,
            tls: {
                crt: this.values.gardener.certs.apiserver.cert,
                key: this.values.gardener.certs.apiserver.privateKey,
            },
            etcd: {
                servers: 'https://garden-etcd-main.garden.svc:2379',
                useSidecar: false,
                caBundle: this.values.etcd.tls.ca.cert,
                tls: {
                    crt: this.values.etcd.tls.client.cert,
                    key: this.values.etcd.tls.client.privateKey,
                },
            },
            resources: defaultResources.apiserver,
            groupPriorityMinimum: 10000,
            insecureSkipTLSVerify: false,
            replicaCount: 1,
            serviceAccountName: 'gardener-apiserver',
            versionPriority: 20,
        }, this.values.gardener.apiserver);
    }

    private controllerValues() {
        return deepMergeObject({
            enabled: true,
            kubeconfig: 'dummy',
            image: {
                tag: GardenerVersion,
            },
            resources: defaultResources.controller,
            replicaCount: 1,
            serviceAccountName: 'gardener-controller-manager',
            additionalVolumeMounts: [],
            additionalVolumes: [],
            alerting: [],
            config: {
                clientConnection: {
                    acceptContentTypes: 'application/json',
                    contentType: 'application/json',
                    qps: 100,
                    burst: 130,
                },
                logLevel: 'info',
                'controllers': {
                    'backupInfrastructure': {
                        'concurrentSyncs': 20,
                        'syncPeriod': '24h',
                    },
                    'seed': {
                        'concurrentSyncs': 5,
                        'reserveExcessCapacity': false,
                        'syncPeriod': '1m',
                    },
                    'shoot': {
                        'concurrentSyncs': 20,
                        'retryDuration': '24h',
                        'syncPeriod': '1h',
                    },
                    'shootCare': {
                        'concurrentSyncs': 5,
                        'conditionThresholds': {
                            'apiServerAvailable': '1m',
                            'controlPlaneHealthy': '1m',
                            'everyNodeReady': '5m',
                            'systemComponentsHealthy': '1m',
                        },
                        'syncPeriod': '30s',
                    },
                    'shootMaintenance': {
                        'concurrentSyncs': 5,
                    },
                    'shootQuota': {
                        'concurrentSyncs': 5,
                        'syncPeriod': '60m',
                    },
                },
                'featureGates': {},
                'leaderElection': {
                    'leaderElect': true,
                    'leaseDuration': '15s',
                    'renewDeadline': '10s',
                    'resourceLock': 'configmaps',
                    'retryPeriod': '2s',
                },
                server: {
                    http: {
                        bindAddress: '0.0.0.0',
                        port: 2718,
                    },
                    https: {
                        bindAddress: '0.0.0.0',
                        port: 2719,
                        tls: {
                            caBundle: this.values.gardener.certs.ca.cert,
                            crt: this.values.gardener.certs.controllerManager.cert,
                            key: this.values.gardener.certs.controllerManager.privateKey,
                        },
                    },
                },
            },
        }, this.values.gardener.admission);
    }

    private admissionValues() {
        return deepMergeObject({
            enabled: true,
            kubeconfig: 'dummy',
            image: {
                tag: GardenerVersion,
            },
            resources: defaultResources.admission,
            replicaCount: 1,
            serviceAccountName: 'gardener-admission-controller',
            config: {
                gardenClientConnection: {
                    acceptContentTypes: 'application/json',
                    contentType: 'application/json',
                    qps: 100,
                    burst: 130,
                },
                server: {
                    https: {
                        bindAddress: '0.0.0.0',
                        port: 2719,
                        tls: {
                            caBundle: this.values.gardener.certs.ca.cert,
                            crt: this.values.gardener.certs.admissionController.cert,
                            key: this.values.gardener.certs.admissionController.privateKey,
                        },
                    },
                },
            },
        }, this.values.gardener.controller);
    }

    private schedulerValues(): Values {
        return deepMergeObject({
            enabled: true,
            kubeconfig: 'dummy',
            image: {
                tag: GardenerVersion,
            },
            resources: defaultResources.scheduler,
            replicaCount: 1,
            serviceAccountName: 'gardener-scheduler',
            config: {
                schedulers: {
                    shoot: {
                        retrySyncPeriod: '1s',
                        concurrentSyncs: 5,
                        candidateDeterminationStrategy: this.values.gardener.seedCandidateDeterminationStrategy,
                    },
                },
            },
        }, this.values.gardener.scheduler);
    }

    private async getKubeConfigForServiceAccount(name: string): Promise<string> {
        if (!this.virtualClient) {
            return `dumy-${name}`;
        }
        const kc = await getKubeConfigForServiceAccount(this.virtualClient, GardenerNamespace, name, log);
        return kc.exportConfig();
    }
}

class RuntimeChart extends Chart {
    constructor(private readonly values: Values) {
        super(
            'gardener-runtime',
            new RemoteChartFromZip(GardenerRepoZipUrl, path.join(GardenerChartBasePath, 'runtime')),
        );
    }

    public async renderValues(values: GeneralValues): Promise<Values> {
        return this.values;
    }
}

class ApplicationChart extends Chart {
    constructor(private readonly values: Values) {
        super(
            'gardener-application',
            new RemoteChartFromZip(GardenerRepoZipUrl, path.join(GardenerChartBasePath, 'application')),
        );
    }

    public async renderValues(values: GeneralValues): Promise<Values> {
        return this.values;
    }
}

export const generateGardenerCerts = (
    gardenNamespace: string,
    ca: CA = createSelfSignedCA('ca-gardener'),
    ): GardenerCertificates => {

    const apiserver = createClientTLS(ca, {
        cn: 'gardener-apiserver',
        extensions: defaultExtensions(),
        altNames: serviceHosts('gardener-apiserver', gardenNamespace),
    });
    const controllerManager = createClientTLS(ca, {
        cn: 'gardener-controller-manager',
        extensions: defaultExtensions(),
        altNames: serviceHosts('gardener-controller-manager', gardenNamespace),
    });
    const admissionController = createClientTLS(ca, {
        cn: 'gardener-admission-controller',
        extensions: defaultExtensions(),
        altNames: serviceHosts('gardener-admission-controller', gardenNamespace),
    });

    return {
        ca,
        apiserver,
        controllerManager,
        admissionController,
    };
};
