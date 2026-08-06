import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, effect, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LayoutComponent } from '../../layout/layout/layout';
import { ToastrService } from 'ngx-toastr';
import { Service } from '../../dashboard/service';

type CategoryType = 'coded' | 'plain';

interface ExtraField {
  key: string;         // matches a column name (description, claim_other, example)
  label: string;
  placeholder?: string;
  // Max length for this column — NOT hardcoded here. Left undefined until
  // loadItems() populates it from the API response's extraColLengths for
  // this key, so it always reflects whatever the backend currently
  // enforces rather than a static guess that can drift out of sync.
  maxLength?: number;
}

interface ConfigCategory {
  key: string;
  label: string;
  type: CategoryType;
  // Must match resolve_coded()/resolve_plain() in master_data_queries.py.
  apiSlug: string;
  // Only used for coded categories — seeded here as a best-guess default
  // (matches CODED_CONFIG's code_length in master_data_queries.py as of
  // this writing) but ALWAYS overwritten by the API response's own
  // codeLength on every loadItems() call — see there. Kept here only so
  // the Code field has a sane maxlength/hint before the first load
  // resolves.
  codeLength?: number;
  codePlaceholder?: string;
  // Populated from the API response's nameMaxLength on every loadItems()
  // call — not hardcoded, since it's authoritative from the backend and
  // can differ per category (and can change server-side independently
  // of this file).
  nameMaxLength?: number;
  // Extra columns this category's table carries beyond code/name — must
  // match CODED_CONFIG's extra_cols for the same category. Empty/undefined
  // for review-type and claim-type, which have no columns left over.
  // Each field's own maxLength is populated from the API response's
  // extraColLengths, same reasoning as nameMaxLength above.
  extraFields?: ExtraField[];
}

interface MasterDataItem {
  name: string;
  code?: string;        // present on coded items
  id?: number;           // present on plain items
  is_active?: number;
  description?: string;  // clients, master_concepts
  claim_other?: string;  // clients only
  example?: string;      // master_concepts only
}

@Component({
  selector: 'app-masterdataconfig',
  imports: [CommonModule, FormsModule, LayoutComponent],
  templateUrl: './masterdataconfig.html',
  styleUrl: './masterdataconfig.css',
})
export class Masterdataconfig {
  categories: ConfigCategory[] = [
    {
      key: 'clientName',
      label: 'Client Name',
      type: 'coded',
      apiSlug: 'client-name',
      codeLength: 3,
      codePlaceholder: 'e.g. CSP',
      extraFields: [
        { key: 'description', label: 'Description' },
        { key: 'claim_other', label: 'Claim Other' },
      ],
    },
    {
      key: 'masterConceptName',
      label: 'Master Concept Name',
      type: 'coded',
      apiSlug: 'master-concept-name',
      codeLength: 4,
      codePlaceholder: 'e.g. 0000',
      extraFields: [
        { key: 'description', label: 'Description' },
        { key: 'example', label: 'Example' },
      ],
    },
    { key: 'reviewType', label: 'Review Type', type: 'coded', apiSlug: 'review-type', codeLength: 1, codePlaceholder: 'e.g. A' },
    { key: 'claimType', label: 'Claim Type', type: 'coded', apiSlug: 'claim-type', codeLength: 1, codePlaceholder: 'e.g. P' },
    { key: 'developmentStatus', label: 'Development Status', type: 'plain', apiSlug: 'development-status' },
    { key: 'priority', label: 'Priority', type: 'plain', apiSlug: 'priority' },
    { key: 'clientApprovalStatus', label: 'Client Approval Status', type: 'plain', apiSlug: 'client-approval-status' },
  ];

  activeCategory = signal<string>(this.categories[0].key);

  items = signal<MasterDataItem[]>([]);
  isLoading = signal(false);

  // ---- Add Configuration modal state ----
  isAddModalOpen = signal(false);
  newItemName = '';
  newItemCode = ''; // only used for coded categories
  newItemExtra: Record<string, string> = {}; // keyed by ExtraField.key
  isSaving = signal(false);

  // ---- Remove/deactivate confirm state ----
  pendingRemoveItem = signal<MasterDataItem | null>(null);
  isRemoving = signal(false);

  constructor(
    private service: Service,
    private toastr: ToastrService,
  ) {
    // Reload the list any time the active category changes.
    effect(() => {
      this.loadItems(this.activeCategory());
    });
  }

  get activeCategoryMeta(): ConfigCategory {
    return this.categories.find((c) => c.key === this.activeCategory())!;
  }

  get activeCategoryLabel(): string {
    return this.activeCategoryMeta?.label ?? '';
  }

  get activeItems(): MasterDataItem[] {
    return this.items();
  }

  itemKey(_index: number, item: MasterDataItem): string | number {
    return item.code ?? item.id ?? item.name;
  }

  // Every coded category's Code field is alpha-only EXCEPT
  // master-concept-name, which is numeric-only (4-digit codes like
  // "0000") — every other coded category (client-name, review-type,
  // claim-type) uses letters only, per the sample data (MRW, CSP, A, P,
  // etc). Centralized here so both the live input-stripping handler and
  // the saveNewItem() validation check stay in sync — if this list of
  // "numeric" categories ever grows, only this needs to change.
  private isNumericCodeCategory(category: ConfigCategory): boolean {
    return category.key === 'masterConceptName';
  }

  /** Strips disallowed characters from the Code field as the user types —
   *  digits only for master-concept-name, letters only for every other
   *  coded category. Mirrors the pattern used elsewhere in this app for
   *  live input restriction (e.g. restrictSpecialChars in
   *  concept-create.ts). Doesn't block paste-then-submit on its own —
   *  saveNewItem()'s own check below is the real enforcement point. */
  onCodeInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const numeric = this.isNumericCodeCategory(this.activeCategoryMeta);
    const cleaned = numeric
      ? input.value.replace(/[^0-9]/g, '')
      : input.value.replace(/[^a-zA-Z]/g, '');
    input.value = cleaned;
    this.newItemCode = cleaned;
  }

  selectCategory(key: string): void {
    this.activeCategory.set(key);
  }

  private loadItems(key: string): void {
    const category = this.categories.find((c) => c.key === key);
    if (!category) return;

    this.isLoading.set(true);

    const request$ =
      category.type === 'coded'
        ? this.service.getCodedMasterData(category.apiSlug)
        : this.service.getPlainMasterData(category.apiSlug);

    request$.subscribe({
      next: (res) => {
        this.items.set(res.items ?? []);

        // The backend is authoritative on these constraints — every
        // response carries its own current codeLength/nameMaxLength/
        // extraColLengths, so pull them in here rather than trusting the
        // static defaults seeded in `categories` above. Without this, a
        // frontend value that's drifted out of sync with the backend
        // (or a backend value that's changed since this file was last
        // updated) would keep silently enforcing the wrong length right
        // up until the create call 400s.
        if (category.type === 'coded' && res.codeLength) {
          category.codeLength = res.codeLength;
        }
        if (res.nameMaxLength) {
          category.nameMaxLength = res.nameMaxLength;
        }
        if (res.extraColLengths) {
          for (const field of category.extraFields ?? []) {
            const len = res.extraColLengths[field.key];
            if (len) field.maxLength = len;
          }
        }

        this.isLoading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.items.set([]);
        this.isLoading.set(false);
        this.toastr.error(err.error?.detail ?? 'Failed to load entries.', 'Error');
      },
    });
  }

  // ---- Add ----

  openAddModal(): void {
    this.newItemName = '';
    this.newItemCode = '';
    this.newItemExtra = {};
    for (const field of this.activeCategoryMeta.extraFields ?? []) {
      this.newItemExtra[field.key] = '';
    }
    this.isAddModalOpen.set(true);
  }

  closeAddModal(): void {
    this.isAddModalOpen.set(false);
  }

  saveNewItem(): void {
    const category = this.activeCategoryMeta;
    const name = this.newItemName.trim();

    if (!name) {
      this.toastr.error('Name is required.', 'Validation Error');
      return;
    }

    // [maxlength] on the Name input blocks further typing once the limit
    // is hit, but doesn't stop a paste that lands over the limit in one
    // go — check explicitly here too, same as the codeLength check below.
    if (category.nameMaxLength && name.length > category.nameMaxLength) {
      this.toastr.error(
        `${category.label} name must be ${category.nameMaxLength} characters or fewer.`,
        'Validation Error',
      );
      return;
    }

    this.isSaving.set(true);

    if (category.type === 'coded') {
      const code = this.newItemCode.trim();
      if (!code) {
        this.isSaving.set(false);
        this.toastr.error('Code is required.', 'Validation Error');
        return;
      }
      if (category.codeLength && code.length !== category.codeLength) {
        this.isSaving.set(false);
        this.toastr.error(
          `${category.label} code must be exactly ${category.codeLength} character${category.codeLength === 1 ? '' : 's'}.`,
          'Validation Error',
        );
        return;
      }

      const numeric = this.isNumericCodeCategory(category);
      const codePattern = numeric ? /^[0-9]+$/ : /^[a-zA-Z]+$/;
      if (!codePattern.test(code)) {
        this.isSaving.set(false);
        this.toastr.error(
          numeric
            ? `${category.label} code must contain numbers only.`
            : `${category.label} code must contain letters only, no numbers or special characters.`,
          'Validation Error',
        );
        return;
      }

      const extraPayload: Record<string, string> = {};
      for (const field of category.extraFields ?? []) {
        const value = (this.newItemExtra[field.key] ?? '').trim();
        if (field.maxLength && value.length > field.maxLength) {
          this.isSaving.set(false);
          this.toastr.error(
            `${field.label} must be ${field.maxLength} characters or fewer.`,
            'Validation Error',
          );
          return;
        }
        extraPayload[field.key] = value;
      }

      this.service
        .createCodedMasterData(category.apiSlug, { code, name, is_active: 1, ...extraPayload })
        .subscribe({
          next: () => {
            this.isSaving.set(false);
            this.closeAddModal();
            this.loadItems(category.key);
            this.toastr.success(`${category.label} added successfully!`, 'Success');
          },
          error: (err: HttpErrorResponse) => {
            this.isSaving.set(false);
            this.toastr.error(err.error?.detail ?? 'Failed to save.', 'Error');
          },
        });
    } else {
      this.service.createPlainMasterData(category.apiSlug, { name }).subscribe({
        next: () => {
          this.isSaving.set(false);
          this.closeAddModal();
          this.loadItems(category.key);
          this.toastr.success(`${category.label} added successfully!`, 'Success');
        },
        error: (err: HttpErrorResponse) => {
          this.isSaving.set(false);
          this.toastr.error(err.error?.detail ?? 'Failed to save.', 'Error');
        },
      });
    }
  }

  // ---- Remove / deactivate ----

  requestRemoveItem(item: MasterDataItem): void {
    this.pendingRemoveItem.set(item);
  }

  cancelRemoveItem(): void {
    this.pendingRemoveItem.set(null);
  }

  confirmRemoveItem(): void {
    const category = this.activeCategoryMeta;
    const item = this.pendingRemoveItem();
    if (!item) return;

    if (category.type === 'coded' && !item.code) {
      this.toastr.success(`${category.label} deleted successfully!`, 'Success');
      return;
    }
    if (category.type === 'plain' && item.id == null) {
      this.toastr.success(`${category.label} deleted successfully!`, 'Success');
      return;
    }

    this.isRemoving.set(true);

    const request$ =
      category.type === 'coded'
        ? this.service.deleteCodedMasterData(category.apiSlug, item.code!)
        : this.service.deletePlainMasterData(category.apiSlug, item.id!);

    request$.subscribe({
      next: () => {
        this.isRemoving.set(false);
        this.pendingRemoveItem.set(null);
        this.loadItems(category.key);
        this.toastr.success('value deleted successfully!', 'Success');
      },
      error: (err: HttpErrorResponse) => {
        this.isRemoving.set(false);
        this.toastr.error(err.error?.detail ?? 'Failed to delete.', 'Error');
      }
    });
  }
}