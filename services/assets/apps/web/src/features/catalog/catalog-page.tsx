import { closestCenter, DndContext, type DragEndEvent, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { buildAttributesSchema, FIELD_TYPE_LABELS } from '@eam/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ChevronRight, Eye, GripVertical, Hash, Lock, Package, Pencil, Plus, Search, Shapes, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useConfirm } from '@/components/common/confirm';
import { attributesToForm, DynamicFields } from '@/components/common/dynamic-fields';
import { useZodForm } from '@/components/common/form';
import { EmptyState, ErrorState, PageHeader } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Skeleton } from '@/components/ui/primitives';
import { useQuickAdd } from '@/features/quick-add/quick-add';
import { api, errorMessage } from '@/lib/api';
import { AssetIcon } from '@/lib/icons';
import { queryClient, useAssetType, useAssetTypes, useCategories } from '@/lib/queries';
import type { AssetType, Category, FieldDefinition } from '@/lib/types';
import { useUrlFilters } from '@/lib/url-state';
import { cn } from '@/lib/utils';
import { FieldDialog } from './field-dialog';

function invalidateCatalog() {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ['categories'] }),
    queryClient.invalidateQueries({ queryKey: ['asset-types'] }),
    queryClient.invalidateQueries({ queryKey: ['asset-type'] }),
    queryClient.invalidateQueries({ queryKey: ['fields'] }),
    queryClient.invalidateQueries({ queryKey: ['filterable-fields'] }),
  ]);
}

export default function CatalogPage() {
  const { values, set } = useUrlFilters();
  const categories = useCategories();
  const types = useAssetTypes();
  const quickAdd = useQuickAdd();
  const [filter, setFilter] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const catId = values.category ?? null;
  const typeId = values.type ?? null;

  useEffect(() => {
    if (!catId && categories.data?.[0]) set({ category: categories.data[0].id });
    if (catId) setExpanded((e) => new Set(e).add(catId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catId, categories.data]);

  const f = filter.trim().toLowerCase();
  const typesByCat = useMemo(() => {
    const m = new Map<string, AssetType[]>();
    for (const t of types.data ?? []) m.set(t.categoryId, [...(m.get(t.categoryId) ?? []), t]);
    return m;
  }, [types.data]);

  if (categories.error) return <ErrorState error={categories.error} onRetry={() => categories.refetch()} />;
  const category = categories.data?.find((c) => c.id === catId) ?? null;

  return (
    <div>
      <PageHeader
        title="Asset catalog"
        description="Define any kind of asset — categories, types and their own fields. No code changes needed."
        actions={
          <>
            <Button size="sm" variant="outline" onClick={() => quickAdd.open('category')}>
              <Plus /> Category
            </Button>
            <Button size="sm" onClick={() => quickAdd.open('assetType', { defaults: { categoryId: catId } })}>
              <Plus /> Asset type
            </Button>
          </>
        }
      />
      <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
        <Card className="h-fit overflow-hidden lg:sticky lg:top-20">
          <div className="border-b p-2.5">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter types…" className="h-8 pl-8 text-[13px]" />
            </div>
          </div>
          <nav className="max-h-[70vh] overflow-y-auto p-1.5 scrollbar-thin">
            {categories.isLoading && Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="m-1 h-8" />)}
            {(categories.data ?? []).map((c) => {
              const list = (typesByCat.get(c.id) ?? []).filter((t) => !f || t.name.toLowerCase().includes(f) || c.name.toLowerCase().includes(f));
              if (f && !list.length && !c.name.toLowerCase().includes(f)) return null;
              const open = expanded.has(c.id) || !!f;
              return (
                <div key={c.id}>
                  <button
                    type="button"
                    onClick={() => {
                      set({ category: c.id, type: null });
                      setExpanded((e) => {
                        const n = new Set(e);
                        if (catId === c.id && n.has(c.id) && !typeId) n.delete(c.id);
                        else n.add(c.id);
                        return n;
                      });
                    }}
                    className={cn('flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition hover:bg-muted', catId === c.id && !typeId && 'bg-accent font-medium')}
                  >
                    <ChevronRight className={cn('size-3.5 text-muted-foreground transition', open && 'rotate-90')} />
                    <AssetIcon icon={c.icon} color={c.color} size="sm" className="size-6" />
                    <span className="flex-1 truncate">{c.name}</span>
                    <span className="text-xs tabular text-muted-foreground">{c.typeCount}</span>
                  </button>
                  {open && (
                    <div className="mb-1 ml-5 border-l pl-2">
                      {list.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => set({ category: c.id, type: t.id })}
                          className={cn('flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-left text-[13px] text-muted-foreground transition hover:bg-muted hover:text-foreground', typeId === t.id && 'bg-accent font-medium text-foreground')}
                        >
                          <span className="flex-1 truncate">{t.name}</span>
                          {t.trackingMode === 'QUANTITY' && <Hash className="size-3" />}
                          <span className="text-[11px] tabular">{t.assetCount}</span>
                        </button>
                      ))}
                      <button type="button" onClick={() => quickAdd.open('assetType', { defaults: { categoryId: c.id } })} className="flex w-full cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-left text-[13px] text-primary hover:bg-primary/5">
                        <Plus className="size-3.5" /> Add type
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </nav>
        </Card>

        <div className="min-w-0">
          {typeId ? (
            <TypePanel typeId={typeId} onDeleted={() => set({ type: null })} />
          ) : category ? (
            <CategoryPanel category={category} types={typesByCat.get(category.id) ?? []} onOpenType={(id) => set({ type: id })} onDeleted={() => set({ category: null })} />
          ) : (
            <EmptyState icon={Shapes} title="Choose a category" />
          )}
        </div>
      </div>
    </div>
  );
}

function SortableRow({ field, onEdit, onDelete }: { field: FieldDefinition; onEdit: () => void; onDelete: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: field.id });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn('flex items-center gap-2 rounded-lg border bg-card px-2 py-2', isDragging && 'z-10 shadow-lg ring-2 ring-primary/30')}>
      <button type="button" className="cursor-grab touch-none rounded p-1 text-muted-foreground hover:bg-muted active:cursor-grabbing" {...attributes} {...listeners} aria-label="Drag to reorder">
        <GripVertical className="size-4" />
      </button>
      <FieldSummary field={field} />
      <Button size="icon-xs" variant="ghost" onClick={onEdit} aria-label="Edit field">
        <Pencil />
      </Button>
      <Button size="icon-xs" variant="ghost" onClick={onDelete} aria-label="Delete field">
        <Trash2 />
      </Button>
    </li>
  );
}

function FieldSummary({ field }: { field: FieldDefinition }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-sm font-medium">{field.label}</span>
        {field.required && <Badge tone="red">Required</Badge>}
        {field.isUnique && <Badge tone="violet">Unique</Badge>}
        {field.showInTable && <Badge tone="gray">In table</Badge>}
      </div>
      <p className="truncate text-xs text-muted-foreground">
        <span className="font-mono">{field.key}</span> · {FIELD_TYPE_LABELS[field.type]}
        {field.options?.length ? ` · ${field.options.join(', ')}` : ''}
        {field.min != null || field.max != null ? ` · ${field.min ?? '…'}–${field.max ?? '…'}` : ''}
      </p>
    </div>
  );
}

function FieldList({ fields, owner }: { fields: FieldDefinition[]; owner: { categoryId?: string; assetTypeId?: string; name: string } }) {
  const confirm = useConfirm();
  const [order, setOrder] = useState(fields);
  const [editing, setEditing] = useState<FieldDefinition | null>(null);
  const [adding, setAdding] = useState(false);
  useEffect(() => setOrder(fields), [fields]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const reorder = useMutation({
    mutationFn: (ids: string[]) => api.post('/fields/reorder', { ids }),
    onSuccess: () => invalidateCatalog(),
    onError: (err) => {
      toast.error(errorMessage(err));
      setOrder(fields);
    },
  });
  const remove = useMutation({
    mutationFn: (f: FieldDefinition) => api.del<{ archived: boolean }>(`/fields/${f.id}`),
    onSuccess: async (r, f) => {
      await invalidateCatalog();
      toast.success(r.archived ? `“${f.label}” archived — existing values are kept on assets` : `“${f.label}” removed`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = order.findIndex((f) => f.id === e.active.id);
    const to = order.findIndex((f) => f.id === e.over!.id);
    const next = arrayMove(order, from, to);
    setOrder(next);
    reorder.mutate(next.map((f) => f.id));
  };

  return (
    <>
      {order.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center">
          <p className="text-sm text-muted-foreground">No fields yet.</p>
          <Button size="sm" variant="outline" className="mt-3" onClick={() => setAdding(true)}>
            <Plus /> Add the first field
          </Button>
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={order.map((f) => f.id)} strategy={verticalListSortingStrategy}>
            <ul className="space-y-1.5">
              {order.map((f) => (
                <SortableRow
                  key={f.id}
                  field={f}
                  onEdit={() => setEditing(f)}
                  onDelete={async () => {
                    const r = await confirm({
                      title: `Remove “${f.label}”?`,
                      description: 'If assets already have values for it, the field is archived instead so no data is lost.',
                      confirmText: 'Remove field',
                      destructive: true,
                    });
                    if (r.confirmed) remove.mutate(f);
                  }}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
      {order.length > 0 && (
        <Button size="sm" variant="outline" className="mt-3" onClick={() => setAdding(true)}>
          <Plus /> Add field
        </Button>
      )}
      <FieldDialog open={adding || !!editing} onOpenChange={(o) => !o && (setAdding(false), setEditing(null))} owner={owner} field={editing} />
    </>
  );
}

function FormPreview({ fields }: { fields: FieldDefinition[] }) {
  const schema = useMemo(() => buildAttributesSchema(fields), [fields]);
  const form = useZodForm(schema, attributesToForm(fields));
  useEffect(() => {
    form.reset(attributesToForm(fields));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields]);
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <Eye className="size-4" /> Form preview
          </CardTitle>
          <CardDescription>What people see when adding this asset. Try it — validation is live.</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {fields.length ? (
          <form
            onSubmit={form.handleSubmit(() => toast.success('Looks valid!'))}
            className="space-y-4"
          >
            <DynamicFields fields={fields} form={form} prefix="" />
            <Button type="submit" size="sm" variant="secondary">
              Validate
            </Button>
          </form>
        ) : (
          <p className="text-sm text-muted-foreground">Add fields to see the form.</p>
        )}
      </CardContent>
    </Card>
  );
}

function TypePanel({ typeId, onDeleted }: { typeId: string; onDeleted: () => void }) {
  const q = useAssetType(typeId);
  const types = useAssetTypes();
  const quickAdd = useQuickAdd();
  const confirm = useConfirm();
  const del = useMutation({
    mutationFn: () => api.del(`/asset-types/${typeId}`),
    onSuccess: async () => {
      await invalidateCatalog();
      toast.success('Asset type deleted');
      onDeleted();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  if (q.isLoading) return <Skeleton className="h-96" />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const t = q.data;
  const inherited = t.fields.filter((f) => f.inherited);
  const own = t.fields.filter((f) => !f.inherited);
  const listRow = types.data?.find((x) => x.id === t.id);

  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="flex flex-col gap-4 pt-5 sm:flex-row sm:items-center">
          <AssetIcon icon={t.icon ?? t.category.icon} color={t.category.color} size="lg" />
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold">{t.name}</h2>
            <p className="text-sm text-muted-foreground">
              {t.category.name} · tag prefix <span className="font-mono">{t.code}-</span> · {t.assetCount} asset(s)
            </p>
            <div className="mt-1.5 flex gap-1.5">
              <Badge tone={t.trackingMode === 'QUANTITY' ? 'cyan' : 'indigo'}>
                {t.trackingMode === 'QUANTITY' ? <Hash /> : <Package />}
                {t.trackingMode === 'QUANTITY' ? 'Tracked by quantity' : 'Tracked individually'}
              </Badge>
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => quickAdd.open('assetType', { record: listRow ?? { ...t, assetCount: t.assetCount } })}>
              <Pencil /> Edit
            </Button>
            <Button size="sm" variant="outline" onClick={() => quickAdd.open('asset', { defaults: { assetTypeId: t.id } })}>
              <Plus /> Add {t.name.toLowerCase()}
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Delete type"
              onClick={async () => {
                const r = await confirm({ title: `Delete “${t.name}”?`, description: t.assetCount ? `${t.assetCount} asset(s) use it — dispose or delete them first.` : 'This cannot be undone.', destructive: true, confirmText: 'Delete type' });
                if (r.confirmed) del.mutate();
              }}
            >
              <Trash2 />
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Fields</CardTitle>
              <CardDescription>Drag to reorder. These appear on every {t.name} form and detail page.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {inherited.length > 0 && (
              <div>
                <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Lock className="size-3" /> From category “{t.category.name}”
                </p>
                <ul className="space-y-1.5">
                  {inherited.map((f) => (
                    <li key={f.id} className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-2">
                      <FieldSummary field={f} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div>
              {inherited.length > 0 && <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t.name} fields</p>}
              <FieldList fields={own} owner={{ assetTypeId: t.id, name: t.name }} />
            </div>
          </CardContent>
        </Card>
        <FormPreview fields={t.fields} />
      </div>
    </div>
  );
}

function CategoryPanel({ category, types, onOpenType, onDeleted }: { category: Category; types: AssetType[]; onOpenType: (id: string) => void; onDeleted: () => void }) {
  const quickAdd = useQuickAdd();
  const confirm = useConfirm();
  const del = useMutation({
    mutationFn: () => api.del(`/categories/${category.id}`),
    onSuccess: async () => {
      await invalidateCatalog();
      toast.success('Category deleted');
      onDeleted();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const fields = useQuery({
    queryKey: ['fields', { categoryId: category.id }],
    queryFn: () => api.get<FieldDefinition[]>('/fields', { categoryId: category.id }),
    placeholderData: undefined,
  });

  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="flex flex-col gap-4 pt-5 sm:flex-row sm:items-center">
          <AssetIcon icon={category.icon} color={category.color} size="lg" />
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold">{category.name}</h2>
            <p className="text-sm text-muted-foreground">
              {category.description ?? 'No description'} · {category.typeCount} type(s) · {category.assetCount} asset(s)
            </p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => quickAdd.open('category', { record: category })}>
              <Pencil /> Edit
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Delete category"
              onClick={async () => {
                const r = await confirm({ title: `Delete “${category.name}”?`, description: category.typeCount ? 'Remove its asset types first.' : 'This cannot be undone.', destructive: true, confirmText: 'Delete category' });
                if (r.confirmed) del.mutate();
              }}
            >
              <Trash2 />
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Shared fields</CardTitle>
              <CardDescription>Every type in {category.name} gets these (e.g. Registration No. for all vehicles).</CardDescription>
            </div>
          </CardHeader>
          <CardContent>{fields.isLoading ? <Skeleton className="h-24" /> : <FieldList fields={fields.data ?? []} owner={{ categoryId: category.id, name: category.name }} />}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Asset types</CardTitle>
              <CardDescription>Each type can add its own fields on top.</CardDescription>
            </div>
            <Button size="xs" variant="outline" onClick={() => quickAdd.open('assetType', { defaults: { categoryId: category.id } })}>
              <Plus /> Type
            </Button>
          </CardHeader>
          <CardContent>
            {!types.length ? (
              <EmptyState icon={Package} title="No types yet" className="py-6" />
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {types.map((t) => (
                  <li key={t.id}>
                    <button type="button" onClick={() => onOpenType(t.id)} className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg border p-2.5 text-left transition hover:border-primary/40">
                      <AssetIcon icon={t.icon ?? t.categoryIcon} color={t.categoryColor} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{t.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {t.fieldCount} fields · {t.assetCount} assets
                        </span>
                      </span>
                      <ChevronRight className="size-4 text-muted-foreground" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
