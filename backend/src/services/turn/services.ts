/**
 * What every stage of a turn reads from the generation service: the database, the
 * configuration and the services a turn calls. One object handed to each stage function, in
 * place of the `this` the stages used while they were methods (ADR-0067).
 */
import type { Config } from '../../config.js';
import type { Database } from '../../db/client.js';
import type { ModelRegistry } from '../../providers/registry.js';
import type { ModelInputStore } from '../attachments/modelInputStore.js';
import type { CapabilityRegistry } from '../../capabilities/registry.js';
import type { ExecutionRuntime } from '../../tools/execution/executionRuntime.js';
import type { SandboxClient } from '../../tools/sandbox/client.js';
import type { SkillService } from '../skills.js';
import type { ObjectStorage } from '../storage.js';
import type { Retriever } from '../retrieval.js';
import type { UsageService } from '../usage.js';
import type { HelperJobs } from '../helpers/helperJobs.js';

export interface TurnServices {
  readonly db: Database;
  readonly cfg: Config;
  readonly registry: ModelRegistry;
  readonly usage: UsageService;
  readonly retriever: Retriever;
  readonly storage: ObjectStorage;
  readonly sandboxClient: SandboxClient | undefined;
  readonly skills: SkillService | undefined;
  readonly capabilities: CapabilityRegistry;
  readonly executionRuntime: ExecutionRuntime;
  readonly modelInputs: ModelInputStore | undefined;
  /** P13 (ADR-0080): the title / summary jobs after the settle, the router shadow. */
  readonly helperJobs?: HelperJobs | undefined;
}
