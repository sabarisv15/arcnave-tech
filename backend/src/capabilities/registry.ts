/**
 * Capability Registry for ArcNave.
 *
 * Tracks what ArcNave can REALLY do at runtime based on configuration,
 * provider support, sandbox availability, and export engine capabilities.
 *
 * Used by:
 * - SkillService: to dynamically downgrade skill modes (full -> guidance_only)
 *   when required capabilities are missing or partial.
 * - SystemPrompt: to only advertise and instruct on truthful, working capabilities.
 * - Health/Diagnostics: to expose runtime capabilities to callers.
 */

export type CapabilityStatus = 'full' | 'partial' | 'unavailable';

export interface Capability {
  readonly id: string;
  readonly status: CapabilityStatus;
  readonly limitation?: string;
  readonly source?: string;
}

export interface CapabilityRegistry {
  get(id: string): Capability | undefined;
  status(id: string): CapabilityStatus;
  isFull(id: string): boolean;
  isAvailable(id: string): boolean;
  list(): readonly Capability[];
}

export class InMemoryCapabilityRegistry implements CapabilityRegistry {
  private readonly capabilities = new Map<string, Capability>();

  constructor(initial: readonly Capability[] = []) {
    for (const cap of initial) {
      this.capabilities.set(cap.id, cap);
    }
  }

  register(capability: Capability): void {
    this.capabilities.set(capability.id, capability);
  }

  get(id: string): Capability | undefined {
    return this.capabilities.get(id);
  }

  status(id: string): CapabilityStatus {
    return this.capabilities.get(id)?.status ?? 'unavailable';
  }

  isFull(id: string): boolean {
    return this.status(id) === 'full';
  }

  isAvailable(id: string): boolean {
    const s = this.status(id);
    return s === 'full' || s === 'partial';
  }

  list(): readonly Capability[] {
    return Array.from(this.capabilities.values());
  }
}
