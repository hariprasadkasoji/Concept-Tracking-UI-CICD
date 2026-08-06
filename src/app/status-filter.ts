import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IFilterAngularComp } from 'ag-grid-angular';
import { IAfterGuiAttachedParams, IDoesFilterPassParams, IFilterParams } from 'ag-grid-community';

interface StatusFilterParams extends IFilterParams {
  options?: string[];
}

@Component({
  selector: 'app-status-filter',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="status-filter-panel">
      <label class="status-filter-option" *ngFor="let opt of options">
        <input
          type="checkbox"
          [checked]="selected.has(opt)"
          (change)="toggle(opt, $any($event.target).checked)"
        />
        {{ opt }}
      </label>
      <div class="status-filter-actions">
        <button type="button" (click)="clear()">Reset</button>
        <button type="button" (click)="apply()">Apply</button>
      </div>
    </div>
  `,
  styles: [`
    .status-filter-panel {
      padding: 10px;
      min-width: 160px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .status-filter-option {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      cursor: pointer;
    }
    .status-filter-actions {
      display: flex;
      justify-content: space-between;
      margin-top: 4px;
      border-top: 1px solid #e2e8f0;
      padding-top: 8px;
    }
    .status-filter-actions button {
      font-size: 12px;
      padding: 4px 10px;
      cursor: pointer;
      border: 1px solid #cbd5e1;
      border-radius: 4px;
      background: #fff;
    }
    .status-filter-actions button:hover {
      background: #f1f5f9;
    }
  `]
})
export class StatusFilterComponent implements IFilterAngularComp {
  private params!: StatusFilterParams;
  options: string[] = [];
  selected = new Set<string>();

  // AG Grid hands us the popup-closing callback here, separately from
  // agInit's params — it's only available once the filter's GUI is
  // actually attached/floated, not at construction time. Stash it so
  // apply()/clear() can use it below.
  private hidePopup: (() => void) | null = null;

  // Called once when the filter is created; also called again if
  // setModel() restores state before the component's ready — agInit
  // is the entry point either way.
  agInit(params: StatusFilterParams): void {
    this.params = params;
    this.options = params.options ?? ['Active', 'Inactive'];
  }

  // Fired every time the filter popup is opened/shown. `params.hidePopup`
  // is the function that actually closes it — without capturing this,
  // there's no way to dismiss the popup ourselves after Apply/Reset,
  // which is why it was staying open.
  afterGuiAttached(params?: IAfterGuiAttachedParams): void {
    this.hidePopup = params?.hidePopup ?? null;
  }

  // Tells AG Grid whether to show the "active filter" funnel icon on
  // the column header.
  isFilterActive(): boolean {
    return this.selected.size > 0;
  }

  // Only used for client-side row models. This grid uses the infinite
  // row model with server-side filtering (see buildFilterModelForApi
  // in user.ts), so this is never actually called to filter rows —
  // AG Grid still requires the method to exist on the interface.
  doesFilterPass(params: IDoesFilterPassParams): boolean {
    if (this.selected.size === 0) return true;
    const value = this.params.getValue(params.node);
    return this.selected.has(value);
  }

  // Serialized model AG Grid stores/restores and hands back via
  // gridApi.getFilterModel() — this is what ends up in the
  // filterModel sent to the backend in buildFilterModelForApi().
  getModel(): any {
    if (this.selected.size === 0) return null;
    return { values: Array.from(this.selected) };
  }

  setModel(model: any): void {
    this.selected = new Set(model?.values ?? []);
  }

  toggle(option: string, checked: boolean): void {
    if (checked) {
      this.selected.add(option);
    } else {
      this.selected.delete(option);
    }
  }

  apply(): void {
    this.params.filterChangedCallback();
    this.hidePopup?.();
  }

  clear(): void {
    this.selected.clear();
    this.params.filterChangedCallback();
    this.hidePopup?.();
  }
}