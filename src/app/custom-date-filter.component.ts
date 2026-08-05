import { Component, ElementRef, HostListener, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDatepicker, MatDatepickerModule } from '@angular/material/datepicker';
import { DateAdapter, MAT_DATE_FORMATS, MatNativeDateModule, NativeDateAdapter } from '@angular/material/core';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { IFilterAngularComp } from 'ag-grid-angular';
import { IFilterParams, IDoesFilterPassParams } from 'ag-grid-community';
 
export class DashDateAdapter extends NativeDateAdapter {
  override format(date: Date): string {
    if (!date) return '';
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `${mm}-${dd}-${yyyy}`;
  }
}
 
export const DASH_DATE_FORMATS = {
  parse: { dateInput: 'MM-DD-YYYY' },
  display: {
    dateInput: 'MM-DD-YYYY',
    monthYearLabel: 'MMM YYYY',
    dateA11yLabel: 'MM-DD-YYYY',
    monthYearA11yLabel: 'MMMM YYYY'
  }
};
 
@Component({
    selector: 'app-custom-date-filter',
    providers: [
        { provide: DateAdapter, useClass: DashDateAdapter },
        { provide: MAT_DATE_FORMATS, useValue: DASH_DATE_FORMATS }
    ],
    imports: [
        CommonModule,
        FormsModule,
        MatDatepickerModule,
        MatNativeDateModule,
        MatInputModule,
        MatIconModule
    ],
template: `
<div #filterRoot class="ag-filter-body-wrapper ag-simple-filter-body-wrapper"
     style="padding:8px; width:196px;">
 
  <!-- OPERATOR -->
  <select
    [(ngModel)]="type"
    class="ag-filter-select ag-filter-condition-operator"
    style="width: 100%; height: 35px; border-radius: 4px; padding: 0 8px;
           border: 1px solid #d1d6db; outline: none; color: #838381;">
 
    @for (f of allowedFilters; track f) {
      <option [value]="f">
        {{ f | titlecase }}
      </option>
    }
 
  </select>
 
  <!-- FROM DATE -->
  <mat-form-field appearance="outline" style="width:100%;">
    <mat-icon matPrefix style="font-size:21px;color:#9aa0a6;">search</mat-icon>
 
    <input
      matInput
      [matDatepicker]="fromPicker"
      placeholder="MM-DD-YYYY"
      [(ngModel)]="tempFromDate"
      readonly
    />
 
    <mat-datepicker-toggle matSuffix [for]="fromPicker"></mat-datepicker-toggle>
    <mat-datepicker #fromPicker panelClass="ag-custom-component-popup"></mat-datepicker>
  </mat-form-field>
 
  <!-- TO DATE -->
  @if (needsToDate()) {
    <mat-form-field appearance="outline" style="width:100%;">
      <mat-icon matPrefix style="font-size:21px;color:#9aa0a6;">search</mat-icon>
 
      <input
        matInput
        [matDatepicker]="toPicker"
        placeholder="MM-DD-YYYY"
        [(ngModel)]="tempToDate"
        readonly
      />
 
      <mat-datepicker-toggle matSuffix [for]="toPicker"></mat-datepicker-toggle>
      <mat-datepicker #toPicker panelClass="ag-custom-component-popup"></mat-datepicker>
    </mat-form-field>
  }
 
  <!-- BUTTONS -->
  <div class="ag-filter-apply-panel" style="display:flex; gap:8px;">
    <button class="ag-standard-button" (click)="reset()">Reset</button>
    <button class="ag-standard-button ag-primary-button" (click)="apply()">Apply</button>
  </div>
 
</div>
`
,
styles: [`
  :host ::ng-deep .mat-mdc-form-field-icon-prefix > .mat-icon,
  :host ::ng-deep .mat-mdc-form-field-icon-suffix > .mat-icon {
    padding: 0 2px !important;
    box-sizing: content-box !important;
  }
 
  :host ::ng-deep .mdc-notched-outline {
    display: flex;
    top: 50%;
    height: 74%;
    transform: translateY(-50%);
    align-items: center;
  }
 
    :host ::ng-deep .mat-mdc-input-element {
      display: flex;
      align-items: center;
      height: 100%;
    }
 
    :host ::ng-deep .mat-mdc-form-field-subscript-wrapper {
      display: none !important;
    }
    :host ::ng-deep .mat-mdc-form-field-flex {
      height: 47px !important;
      align-items: center;
    }
      :host ::ng-deep .mat-mdc-form-field-infix {
       width: 77% !important;  
       }
  `]
})
export class CustomDateFilterComponent implements IFilterAngularComp {
 
  @ViewChild('fromPicker') fromPicker!: MatDatepicker<Date>;
  @ViewChild('toPicker') toPicker!: MatDatepicker<Date>;
  @ViewChild('filterRoot', { read: ElementRef })
  filterRoot!: ElementRef<HTMLElement>;
  params!: IFilterParams;
 
  allowedFilters: string[] = [];
  operatorLogic: Record<string, string> = {};
 
  type = '';
  fromDate: Date | null = null;
  toDate: Date | null = null;
  tempFromDate: Date | null = null;
tempToDate: Date | null = null;
 
private applied = false;
 
 agInit(params: IFilterParams): void {
  this.params = params;
  const fp = params.colDef?.filterParams as any;
  this.allowedFilters = (fp?.allowedFilters ?? ['equals'])
    .map((f: string) => f.toLowerCase());
  this.type = this.allowedFilters[0];
}
 
  isFilterActive(): boolean {
    return !!this.fromDate;
  }
 
  needsToDate(): boolean {
    return this.operatorLogic[this.type] === 'range' || this.type === 'Between' || this.type === 'between';
  }
  doesFilterPass(params: IDoesFilterPassParams): boolean {
    if (!this.fromDate) return false;
 
    const value = params.data?.[this.params.colDef.field!];
    if (!value) return false;
 
    const cell = new Date(value).getTime();
    const from = this.fromDate.getTime();
    const to = this.toDate?.getTime();
 
    const exec: Record<string, () => boolean> = {
      eq: () => cell === from,
      neq: () => cell !== from,
      gt: () => cell > from,
      lt: () => cell < from,
      range: () => to !== undefined && cell >= from && cell <= to
    };
 
    return exec[this.operatorLogic[this.type]]?.() ?? false;
  }
getModel() {
  if (!this.fromDate) return null;
 
  return {
    filterType: 'date',
    type: this.type,
    dateFrom: this.formatDateOnly(this.fromDate),
    dateTo: this.formatDateOnly(this.toDate)
  };
}
private formatDateOnly(date: Date | null): string | null {
  if (!date) return null;
 
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
 
  return `${year}-${month}-${day}`;
}
 
 
setModel(model: any): void {
  if (!model) {
    this.type = this.allowedFilters[0];
    this.fromDate = null;
    this.toDate = null;
 
    this.tempFromDate = null;
    this.tempToDate = null;
    return;
  }
 
  this.type = model.type === 'inRange' ? 'between' : model.type;
  this.fromDate = model.dateFrom ? new Date(model.dateFrom) : null;
  this.toDate = model.dateTo ? new Date(model.dateTo) : null;
  this.tempFromDate = this.fromDate;
  this.tempToDate = this.toDate;
}
 
apply() {
  this.applied = true;
  this.fromDate = this.tempFromDate;
  this.toDate = this.tempToDate;
  this.params.filterChangedCallback();
  this.params.api.hidePopupMenu();
}
 
reset() {
  this.applied = true;
  this.fromDate = null;
  this.toDate = null;
  this.tempFromDate = null;
  this.tempToDate = null;
 
  this.params.filterChangedCallback();
  this.params.api.hidePopupMenu();
}
@HostListener('document:click', ['$event'])
handleDocumentClick(event: MouseEvent) {
  if (!this.filterRoot) return;
 
  const target = event.target as HTMLElement;
  if (this.filterRoot.nativeElement.contains(target)) {
    return;
  }
  if (
    target.closest('.cdk-overlay-pane') ||
    target.closest('.mat-datepicker-content')
  ) {
    return;
  }
  this.fromPicker?.close();
  this.toPicker?.close();
}
 
 
afterGuiDetached(): void {
  if (!this.applied) {
    this.tempFromDate = this.fromDate;
    this.tempToDate = this.toDate;
  }
  this.applied = false;
}
 
 
}
