import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { EmployeeStatus, HolderType } from '@eam/shared';
import { badRequest } from '../../common/http';
import { DbService } from '../../db/db.service';
import { companies, departments, employees, locations, vendors } from '../../db/schema';

export interface ResolvedHolder {
  holderType: HolderType;
  holderId: string;
  name: string;
  /** Column values for the allocation row. */
  columns: {
    employeeId: string | null;
    departmentId: string | null;
    locationId: string | null;
    companyId: string | null;
    vendorId: string | null;
  };
  /** Physical location implied by the holder (used to update the asset's location). */
  impliedLocationId: string | null;
  employeeStatus?: EmployeeStatus;
}

const EMPTY = { employeeId: null, departmentId: null, locationId: null, companyId: null, vendorId: null };

/** Resolves "who/what is holding the asset" for any of the six holder types. */
@Injectable()
export class HoldersService {
  constructor(private readonly dbs: DbService) {}

  async resolve(holderType: HolderType, rawHolderId: string | null | undefined): Promise<ResolvedHolder> {
    const db = this.dbs.db;
    const holderId = rawHolderId || (holderType === 'INVENTORY' ? await this.dbs.defaultStoreId() : null);
    if (!holderId) throw badRequest('Choose who receives it', { holderId: 'Required' });
    switch (holderType) {
      case 'EMPLOYEE': {
        const [e] = await db
          .select({ id: employees.id, name: employees.fullName, code: employees.employeeCode, status: employees.status, locationId: employees.locationId })
          .from(employees)
          .where(eq(employees.id, holderId));
        if (!e) throw badRequest('Employee not found', { holderId: 'Employee not found' });
        if (e.status === 'EXITED') throw badRequest(`${e.name} has exited and cannot receive assets`);
        return {
          holderType,
          holderId,
          name: `${e.name} (${e.code})`,
          columns: { ...EMPTY, employeeId: e.id },
          impliedLocationId: e.locationId,
          employeeStatus: e.status,
        };
      }
      case 'DEPARTMENT': {
        const [d] = await db.select({ id: departments.id, name: departments.name }).from(departments).where(eq(departments.id, holderId));
        if (!d) throw badRequest('Department not found', { holderId: 'Department not found' });
        return { holderType, holderId, name: d.name, columns: { ...EMPTY, departmentId: d.id }, impliedLocationId: null };
      }
      case 'LOCATION':
      case 'INVENTORY': {
        const [l] = await db
          .select({ id: locations.id, name: locations.name, isStore: locations.isStore })
          .from(locations)
          .where(eq(locations.id, holderId));
        if (!l) throw badRequest('Location not found', { holderId: 'Location not found' });
        return { holderType, holderId, name: l.name, columns: { ...EMPTY, locationId: l.id }, impliedLocationId: l.id };
      }
      case 'COMPANY': {
        const [c] = await db.select({ id: companies.id, name: companies.name }).from(companies).where(eq(companies.id, holderId));
        if (!c) throw badRequest('Company not found', { holderId: 'Company not found' });
        return { holderType, holderId, name: c.name, columns: { ...EMPTY, companyId: c.id }, impliedLocationId: null };
      }
      case 'VENDOR': {
        const [v] = await db.select({ id: vendors.id, name: vendors.name }).from(vendors).where(eq(vendors.id, holderId));
        if (!v) throw badRequest('Vendor not found', { holderId: 'Vendor not found' });
        return { holderType, holderId, name: v.name, columns: { ...EMPTY, vendorId: v.id }, impliedLocationId: null };
      }
    }
  }
}
