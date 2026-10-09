import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PlatformStore} from './store.js';
import {LocalObjectStorage} from './objectStorage.js';
import {DeterministicAIGateway} from './aiGateway.js';
import {MockProclaimAdapter} from './adapters.js';
import {Platform} from './platform.js';
import {StaticAuthProvider} from './auth.js';
import {createApiServer} from './httpApi.js';
import {IntegrationRegistry, integrationSummary} from './integrationRegistry.js';
import {MockGraphHarness} from './graphHarness.js';
import {ProclaimValidationHarness} from './proclaimValidation.js';
import {WorkOrchestrator} from './workOrchestration.js';
import {WorkAuthorizer} from './workAuthorization.js';
import {WorkApiService} from './workApi.js';

if (process.env.NODE_ENV === 'production') throw new Error('Synthetic development server is forbidden in production');
if (process.env.LEGALTECH_ENABLE_SYNTHETIC_DEV_SERVER !== 'true') throw new Error('Set LEGALTECH_ENABLE_SYNTHETIC_DEV_SERVER=true to run the local synthetic server');

const here=path.dirname(fileURLToPath(import.meta.url));
const dataDir=process.env.LEGALTECH_DEV_DATA_DIR || path.join(here,'..','.dev-data');
fs.mkdirSync(dataDir,{recursive:true});
const dbFile=path.join(dataDir,'platform.sqlite');
const objectDir=path.join(dataDir,'objects');
const uiRoot=path.join(here,'..','ui');

const seed={matters:[
  {id:'mat_demo_1',tenantId:'tenant-demo',externalId:'PROCLAIM-DEMO-1',externalRefs:['DEMO-10001','CLM-10001'],clientLabel:'Matter A',practiceArea:'Personal Injury',stage:'Medical Evidence'},
  {id:'mat_demo_2',tenantId:'tenant-demo',externalId:'PROCLAIM-DEMO-2',externalRefs:['DEMO-10002','CLM-10002'],clientLabel:'Matter B',practiceArea:'Personal Injury',stage:'Liability'},
]};
const store=new PlatformStore(dbFile,seed);
const proclaimAdapter=new MockProclaimAdapter();
const platform=new Platform({store,objectStorage:new LocalObjectStorage(objectDir),aiGateway:new DeterministicAIGateway(),proclaim:proclaimAdapter});
const registry=new IntegrationRegistry();
const graphHarness=new MockGraphHarness({registry,tenantId:'tenant-demo'}); graphHarness.configure();
const proclaimHarness=new ProclaimValidationHarness({registry,adapter:proclaimAdapter,tenantId:'tenant-demo'}); proclaimHarness.configure();
const integrations={registry,graph:graphHarness,proclaim:proclaimHarness,summary:(tenantId)=>({items:integrationSummary(registry,tenantId),graph:graphHarness.healthCheck()})};
const workOrchestrator=new WorkOrchestrator({store});
const workApi=new WorkApiService({orchestrator:workOrchestrator,authorizer:new WorkAuthorizer({store})});
const authProvider=new StaticAuthProvider([{token:'local-dev-only-token',actorId:'local-developer',tenantId:'tenant-demo',roles:['developer'],capabilities:['matter:read','inbound:read','inbound:create','exception:read','exception:resolve','audit:read','integration:read','integration:manage','dev:workers','work:read:any','work:create','work:update:any','work:respond:any','work:assign']}]);

// Seed one review item only on a brand-new local database so the UI is useful immediately.
if (store.countEvents('tenant-demo')===0) {
  platform.ingest({tenantId:'tenant-demo',idempotencyKey:'ui-demo-seed-0001',input:{sourceSystem:'MANUAL',subject:'New correspondence without matter reference',body:'Medical records have arrived and need reviewing.'}});
  await platform.processNext();
}

const server=createApiServer({platform,authProvider,devWorkers:true,uiRoot,integrations,workApi});
const port=Number(process.env.PORT||3210);
server.listen(port,'127.0.0.1',()=>{
  console.log(`LegalTech synthetic app listening on http://127.0.0.1:${port}`);
  console.log('Synthetic UI and API only. Development bearer token: local-dev-only-token');
  console.log('This server refuses NODE_ENV=production.');
});

const shutdown=()=>server.close(()=>{store.close();process.exit(0);});
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
