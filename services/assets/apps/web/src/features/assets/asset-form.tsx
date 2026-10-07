import {
  ASSET_STATUS_LABELS,
  assetCreateSchema,
  assetUpdateSchema,
  buildAttributesSchema,
  CONDITIONS,
  type HolderType,
  humanize,
  INITIAL_ASSET_STATUSES,
  OWNERSHIP_TYPES,
} from '@eam/shared';
import { useMutation } from '@tanstack/react-query';
import { Info, UserPlus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { attributesToForm, DynamicFields } from '@/components/common/dynamic-fields';
import { applyServerErrors, errorOf, Field, FormSection, useZodForm } from '@/components/common/form';
import { FormSheet } from '@/components/common/form-sheet';
import { PhotoPicker, uploadPhotos } from '@/components/common/photos';
import { Combobox, EntityPicker, HolderPicker } from '@/components/common/pickers';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Separator, Skeleton, Switch } from '@/components/ui/primitives';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { AssetIcon } from '@/lib/icons';
import { invalidateAssetData, useAssetType, useAssetTypes, useCompanies } from '@/lib/queries';
import type { AssetDetail } from '@/lib/types';
import { todayISO } from '@/lib/utils';
import type { FormProps } from '../quick-add/quick-add';

const blank = (v: unknown) => (v === null || v === undefined ? '' : v);

export default function AssetForm({ open, onOpenChange, record, defaults }: FormProps) {
  const asset = record as AssetDetail | undefined;
  const editing = !!asset;
  const navigate = useNavigate();
  const { can } = useAuth();
  const types = useAssetTypes();
  const companies = useCompanies();
  const [typeId, setTypeId] = useState<string | null>(asset?.assetTypeId ?? defaults?.assetTypeId ?? null);
  const type = useAssetType(typeId);
  const fields = useMemo(() => type.data?.fields ?? [], [type.data]);
  const pooled = type.data?.trackingMode === 'QUANTITY';

  const [assignNow, setAssignNow] = useState<boolean>(!!defaults?.holderId);
  const [holderType, setHolderType] = useState<HolderType>(defaults?.holderType ?? 'EMPLOYEE');
  const [holderId, setHolderId] = useState<string | null>(defaults?.holderId ?? null);
  const [holderError, setHolderError] = useState<string | null>(null);
  const [photos, setPhotos] = useState<File[]>([]);

  const schema = useMemo(() => (editing ? assetUpdateSchema : assetCreateSchema).extend({ attributes: buildAttributesSchema(fields) }), [editing, fields]);

  const form = useZodForm(schema, {
    name: asset?.name ?? defaults?.name ?? '',
    status: 'AVAILABLE',
    condition: asset?.condition ?? 'NEW',
    quantity: asset?.quantity ?? 1,
    serialNumber: blank(asset?.serialNumber),
    manufacturer: blank(asset?.manufacturer),
    model: blank(asset?.model),
    description: blank(asset?.description),
    ownership: asset?.ownership ?? 'OWNED',
    ownerCompanyId: blank(asset?.ownerCompanyId),
    vendorId: blank(asset?.vendorId),
    purchaseDate: blank(asset?.purchaseDate ?? (editing ? null : todayISO())),
    purchaseCost: blank(asset?.purchaseCost),
    currency: asset?.currency ?? 'INR',
    invoiceNumber: blank(asset?.invoiceNumber),
    warrantyExpiry: blank(asset?.warrantyExpiry),
    locationId: blank(asset?.locationId ?? defaults?.locationId),
    attributes: {},
    ...(editing ? { version: asset.version } : { assetTypeId: typeId ?? '' }),
  });
  useEffect(() => {
    if (!editing) form.setValue('assetTypeId' as 'name', typeId ?? '');
  }, [typeId, editing, form]);

  // Default owner company for new assets.
  useEffect(() => {
    if (!editing && !form.getValues('ownerCompanyId') && companies.data?.[0]) form.setValue('ownerCompanyId', companies.data[0].id);
  }, [companies.data, editing, form]);

  // Load the custom fields of the chosen type into the form.
  useEffect(() => {
    if (type.data) form.setValue('attributes', attributesToForm(fields, asset?.attributes ?? {}));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type.data]);

  // Suggest a name from manufacturer + model until the user types one.
  const manufacturer = form.watch('manufacturer');
  const model = form.watch('model');
  useEffect(() => {
    if (editing || defaults?.name || form.getFieldState('name').isDirty) return;
    const suggestion = [manufacturer, model].filter(Boolean).join(' ').trim();
    if (suggestion) form.setValue('name', suggestion);
  }, [manufacturer, model, editing, form]);

  const status = form.watch('status');
  useEffect(() => {
    if (assignNow && status !== 'AVAILABLE') form.setValue('status', 'AVAILABLE');
  }, [assignNow, status, form]);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      editing ? api.patch<AssetDetail>(`/assets/${asset.id}`, body) : api.post<AssetDetail>('/assets', body),
  });

  const submit = (addAnother: boolean) =>
    form.handleSubmit(async (values) => {
      if (!typeId) return;
      if (!editing && assignNow && !holderId) {
        setHolderError('Choose who receives it');
        return;
      }
      const body = editing
        ? values
        : { ...values, assetTypeId: typeId, assignTo: assignNow && holderId ? { holderType, holderId } : null };
      try {
        const saved = await save.mutateAsync(body);
        if (!editing && photos.length) {
          // The asset is already saved; a failed upload must not look like a failed save.
          await uploadPhotos(saved.id, null, 'ASSET', photos).catch((err) => toast.error(`Asset added, but the photos did not upload: ${errorMessage(err)}`));
        }
        await invalidateAssetData();
        if (editing) {
          toast.success('Asset updated');
          onOpenChange(false);
          return;
        }
        toast.success(`${saved.assetTag} added`, {
          description: saved.name,
          action: { label: 'Open', onClick: () => navigate(`/assets/${saved.id}`) },
        });
        if (addAnother) {
          form.reset({ ...form.getValues(), name: '', serialNumber: '', attributes: attributesToForm(fields, {}) });
          setHolderId(null);
          setPhotos([]);
        } else {
          onOpenChange(false);
        }
      } catch (err) {
        if (!applyServerErrors(form, err)) toast.error(errorMessage(err));
        else toast.error(errorMessage(err));
      }
    });

  const typeOptions = (types.data ?? []).map((t) => ({
    value: t.id,
    label: t.name,
    description: `${t.categoryName} · ${t.code}${t.trackingMode === 'QUANTITY' ? ' · by quantity' : ''}`,
    icon: <AssetIcon icon={t.icon ?? t.categoryIcon} color={t.categoryColor} size="sm" />,
  }));
  const e = (name: string) => errorOf(form, name);

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={editing ? `Edit ${asset.assetTag}` : 'Add asset'}
      description={editing ? asset.name : defaults?.holderLabel ? `It will be assigned to ${defaults.holderLabel}.` : 'Anything the company owns, leases, stores or uses.'}
      onSubmit={submit(false)}
      submitting={save.isPending}
      submitLabel={editing ? 'Save changes' : 'Add asset'}
      secondaryAction={
        !editing && typeId ? (
          <Button type="button" variant="secondary" disabled={save.isPending} onClick={() => submit(true)()}>
            Save & add another
          </Button>
        ) : undefined
      }
    >
      <Field label="Asset type" required hint={editing ? 'The type cannot change after creation.' : 'Pick what it is — the form adapts to the type.'}>
        <Combobox
          value={typeId}
          onChange={(v) => setTypeId(v)}
          options={typeOptions}
          disabled={editing}
          clearable={false}
          placeholder="Laptop, Car, SIM Card, Helmet…"
          searchPlaceholder="Search asset types…"
          loading={types.isLoading}
        />
      </Field>

      {!typeId ? (
        <div className="flex items-start gap-3 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" />
          <p>
            Choose an asset type to continue. Missing one?{' '}
            {can('catalog:manage') ? 'Create it under Settings → Asset catalog — no code changes needed.' : 'Ask an administrator to add it.'}
          </p>
        </div>
      ) : type.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-9" />
          <Skeleton className="h-9" />
          <Skeleton className="h-24" />
        </div>
      ) : (
        <>
          <FormSection title="Basics">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Manufacturer / brand" error={e('manufacturer')}>
                <Input placeholder="Dell, Honda, Canon…" {...form.register('manufacturer')} />
              </Field>
              <Field label="Model" error={e('model')}>
                <Input placeholder="Latitude 7440" {...form.register('model')} />
              </Field>
              <Field label="Name" required error={e('name')} className="sm:col-span-2" hint="Shown everywhere. Filled from brand + model if left alone.">
                <Input placeholder={type.data?.name} {...form.register('name')} />
              </Field>
              {!pooled && (
                <Field label="Serial number" error={e('serialNumber')}>
                  <Input className="font-mono" {...form.register('serialNumber')} />
                </Field>
              )}
              {pooled && (
                <Field label="Quantity" required error={e('quantity')} hint={editing ? 'Total units, including assigned ones.' : 'How many units in stock.'}>
                  <Input type="number" min={1} {...form.register('quantity')} />
                </Field>
              )}
              <Field label="Condition" error={e('condition')}>
                <NativeSelect {...form.register('condition')}>
                  {CONDITIONS.map((c) => (
                    <option key={c} value={c}>
                      {humanize(c)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              {!editing && (
                <Field label="Starting status" error={e('status')} hint={assignNow ? 'Assigned right away.' : undefined}>
                  <NativeSelect {...form.register('status')} disabled={assignNow}>
                    {INITIAL_ASSET_STATUSES.filter((s) => !(pooled && s === 'IN_INVENTORY')).map((s) => (
                      <option key={s} value={s}>
                        {ASSET_STATUS_LABELS[s]}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              )}
            </div>
          </FormSection>

          {fields.length > 0 && (
            <>
              <Separator />
              <FormSection title={`${type.data?.name} details`} description="Custom fields defined for this type and its category.">
                <DynamicFields fields={fields} form={form} />
              </FormSection>
            </>
          )}

          <Separator />
          <FormSection title="Purchase & ownership">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Ownership" error={e('ownership')}>
                <NativeSelect {...form.register('ownership')}>
                  {OWNERSHIP_TYPES.map((o) => (
                    <option key={o} value={o}>
                      {humanize(o)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Vendor / supplier" error={e('vendorId')}>
                <EntityPicker kind="VENDOR" value={(form.watch('vendorId') as string) || null} onChange={(v) => form.setValue('vendorId', v ?? '', { shouldDirty: true })} />
              </Field>
              <Field label="Invoice number" error={e('invoiceNumber')}>
                <Input {...form.register('invoiceNumber')} />
              </Field>
              <Field label="Purchase date" error={e('purchaseDate')}>
                <Input type="date" {...form.register('purchaseDate')} />
              </Field>
              <Field label="Warranty / expiry" error={e('warrantyExpiry')} hint="Warranty end, or expiry for licences and subscriptions.">
                <Input type="date" {...form.register('warrantyExpiry')} />
              </Field>
            </div>
            <Field label="Notes" error={e('description')}>
              <Textarea rows={2} {...form.register('description')} />
            </Field>
          </FormSection>

          {!editing && (
            <>
              <Separator />
              <FormSection title="Photos">
                <PhotoPicker files={photos} onChange={setPhotos} hint="Optional · up to 6 photos of the asset as it arrives" />
              </FormSection>
            </>
          )}

          {!editing && can('asset:assign') && (
            <>
              <Separator />
              <section className="space-y-3">
                <label className="flex cursor-pointer items-center justify-between gap-3">
                  <span>
                    <span className="flex items-center gap-2 text-sm font-semibold">
                      <UserPlus className="size-4" /> Assign now
                    </span>
                    <span className="text-xs text-muted-foreground">Hand it to an employee, department or vendor in the same step.</span>
                  </span>
                  <Switch checked={assignNow} onCheckedChange={setAssignNow} />
                </label>
                {assignNow && (
                  <div>
                    <HolderPicker
                      holderType={holderType}
                      holderId={holderId}
                      selectedLabel={holderId === defaults?.holderId ? defaults?.holderLabel : undefined}
                      allowed={['EMPLOYEE', 'DEPARTMENT', 'VENDOR']}
                      invalid={!!holderError}
                      onChange={(t, id) => {
                        setHolderType(t);
                        setHolderId(id);
                        setHolderError(null);
                      }}
                    />
                    {holderError && <p className="mt-1 text-xs text-destructive">{holderError}</p>}
                  </div>
                )}
              </section>
            </>
          )}
        </>
      )}
    </FormSheet>
  );
}
