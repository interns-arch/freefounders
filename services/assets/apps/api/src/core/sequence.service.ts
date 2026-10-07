import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DbService } from '../db/db.service';

/** Atomic, gap-tolerant counters for asset tags (LAP-000123) and document numbers (EXIT-00012). */
@Injectable()
export class SequenceService {
  constructor(private readonly dbs: DbService) {}

  async next(prefix: string, pad = 5): Promise<string> {
    const result = await this.dbs.db.execute<{ last_value: number }>(sql`
      insert into sequences (prefix, last_value) values (${prefix}, 1)
      on conflict (prefix) do update set last_value = sequences.last_value + 1
      returning last_value`);
    return `${prefix}-${String(result.rows[0].last_value).padStart(pad, '0')}`;
  }
}
