import { randomUUID } from 'node:crypto';
import { mkdir, appendFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export type TillerUserStatus = 'yes' | 'no' | 'not-sure' | 'prefer-not-to-say';

export interface WaitlistEntryInput {
  firstName: string;
  email: string;
  tillerUser?: TillerUserStatus;
}

export interface WaitlistEntry extends WaitlistEntryInput {
  id: string;
  createdAt: string;
}

export interface WaitlistStore {
  save(entry: WaitlistEntry): Promise<void>;
}

export class FileWaitlistStore implements WaitlistStore {
  constructor(private readonly filePath: string) {}

  async save(entry: WaitlistEntry): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, `${JSON.stringify(entry)}\n`, 'utf8');
  }
}

export class WaitlistService {
  constructor(private readonly store: WaitlistStore) {}

  async join(input: WaitlistEntryInput): Promise<WaitlistEntry> {
    const entry: WaitlistEntry = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      firstName: input.firstName.trim(),
      email: input.email.trim().toLowerCase(),
      tillerUser: input.tillerUser ?? 'prefer-not-to-say',
    };

    await this.store.save(entry);

    return entry;
  }
}
