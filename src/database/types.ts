import type { PoolClient } from "pg";

export type Migration = {
  /** Stable version, e.g. "0001" */
  version: string;
  /** Human-readable snake_case name */
  name: string;
  up: (client: PoolClient) => Promise<void>;
  /** Optional. Never invoked automatically at startup. */
  down?: (client: PoolClient) => Promise<void>;
};

export type AppliedMigration = {
  version: string;
  name: string;
  applied_at: Date;
};

export type MigrationStatus = {
  version: string;
  name: string;
  status: "applied" | "pending" | "missing";
  appliedAt?: string;
};
