import {
  AfterViewInit,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  Renderer2,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IFilterAngularComp } from 'ag-grid-angular';
import { IAfterGuiAttachedParams, IDoesFilterPassParams, IFilterParams } from 'ag-grid-community';

interface DateFilterParams extends IFilterParams {
  filterOptions?: string[];
}

// Not a fixed union — whatever operator strings the caller passes in via
// filterParams.filterOptions (meta.filterOperations from the backend,
// falling back to DEFAULT_TYPE_OPTIONS below) drive the dropdown,
// verbatim and in that order. Known operators get the friendly labels
// below (matching the wording used for this same filter set elsewhere,
// e.g. dashboard.ts); anything unrecognized still shows up (humanized
// from its camelCase key) rather than silently vanishing from the list.
type DateFilterType = string;

// Equals / Does not equal / After / Before / Between — same operator
// set and ordering as dashboard.ts's date columns.
const DEFAULT_TYPE_OPTIONS: DateFilterType[] = [
  'equals', 'notEqual', 'greaterThan', 'lessThan', 'inRange'
];

const KNOWN_LABELS: Record<string, string> = {
  equals: 'Equals',
  notEqual: 'Does not equal',
  lessThan: 'Before',
  lessThanOrEqual: 'On or before',
  greaterThan: 'After',
  greaterThanOrEqual: 'On or after',
  inRange: 'Between',
  blank: 'Blank',
  notBlank: 'Not blank',
};

// Fallback for any operator key that isn't in KNOWN_LABELS above —
// turns e.g. "someNewOperator" into "Some new operator" instead of
// hiding it or showing the raw camelCase key.
function humanize(key: string): string {
  const withSpaces = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  const lower = withSpaces.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

// Model shape mirrors AG Grid's own built-in date filter model
// ({ filterType: 'date', type, dateFrom, dateTo }) so the backend contract
// (already built around agDateColumnFilter's default output) doesn't need
// to change — only how the date is entered/displayed on screen does.
interface DateFilterModel {
  filterType: 'date';
  type: DateFilterType;
  dateFrom: string;
  dateTo?: string | null;
}

interface CalendarDay {
  date: Date;
  day: number;
  inMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
}

const WEEKDAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

@Component({
  selector: 'app-date-filter',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="date-filter-panel">
      <select *ngIf="typeOptions.length > 1" class="date-filter-select" [(ngModel)]="type" (ngModelChange)="onTypeChange()">
        <option *ngFor="let opt of typeOptions" [value]="opt">{{ labelFor(opt) }}</option>
      </select>

      <div class="date-filter-field" *ngIf="needsDateInput">
        <label class="date-filter-field-label">{{ type === 'inRange' ? 'From' : 'Date' }}</label>
        <div class="date-filter-input-row">
          <input
            type="text"
            class="date-filter-input"
            placeholder="MM/DD/YYYY"
            maxlength="10"
            [(ngModel)]="fromText"
            (input)="onDateInput($event, 'from')"
            (focus)="closeCalendar()"
          />
          <button
            type="button"
            class="btn-calendar"
            [class.active]="openCalendarFor === 'from'"
            (click)="toggleCalendar('from', $event)"
            aria-label="Open calendar"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" stroke-width="2"/>
              <path d="M3 9H21" stroke="currentColor" stroke-width="2"/>
              <path d="M8 3V6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              <path d="M16 3V6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
      </div>

      <div class="date-filter-field" *ngIf="type === 'inRange'">
        <label class="date-filter-field-label">To</label>
        <div class="date-filter-input-row">
          <input
            type="text"
            class="date-filter-input"
            placeholder="mm/dd/yyyy"
            maxlength="10"
            [(ngModel)]="toText"
            (input)="onDateInput($event, 'to')"
            (focus)="closeCalendar()"
          />
          <button
            type="button"
            class="btn-calendar"
            [class.active]="openCalendarFor === 'to'"
            (click)="toggleCalendar('to', $event)"
            aria-label="Open calendar"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" stroke-width="2"/>
              <path d="M3 9H21" stroke="currentColor" stroke-width="2"/>
              <path d="M8 3V6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              <path d="M16 3V6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
      </div>

      <div class="date-filter-error" *ngIf="error">{{ error }}</div>

      <div class="date-filter-actions">
        <button type="button" class="btn-reset" (click)="clear()">Reset</button>
        <button type="button" class="btn-apply" (click)="apply()">Apply</button>
      </div>
    </div>

    <!--
      Calendar popup lives OUTSIDE .date-filter-panel and is position:fixed,
      anchored via popupTop/popupLeft (computed from the calendar button's
      real screen position — see toggleCalendar()). This is what lets it
      float freely above ag-Grid's (fixed-size, overflow-clipping) filter
      popup container instead of being squeezed/scrolled inside it.

      IMPORTANT: the "ag-custom-component-popup" class is AG Grid's own,
      documented way of telling its PopupService "clicks inside this
      element are not outside clicks." Because this element is appended
      to document.body (see ngAfterViewInit), it is a DOM sibling of
      AG Grid's filter popup, not a descendant of it — so without this
      class, AG Grid's popup-dismissal logic treats every click inside
      the calendar (day cells, prev/next month arrows, etc) as a click
      outside the filter and closes the whole filter popup.
      Do NOT try to solve this with event.stopPropagation() instead —
      AG Grid's outside-click detection walks the DOM/element path
      rather than relying on event bubbling, so stopPropagation doesn't
      stop it, and can end up interfering with normal click handling
      (e.g. day selection silently not registering).
    -->
    <div
      #calendarPopup
      class="calendar-popup ag-custom-component-popup"
      [style.display]="openCalendarFor ? 'block' : 'none'"
      [style.top.px]="popupTop"
      [style.left.px]="popupLeft"
    >
      <div class="calendar-header">
        <button type="button" class="calendar-nav" (click)="prevMonth()" aria-label="Previous month">&#8249;</button>
        <span class="calendar-title">{{ monthLabel }} {{ viewYear }}</span>
        <button type="button" class="calendar-nav" (click)="nextMonth()" aria-label="Next month">&#8250;</button>
      </div>
      <div class="calendar-weekdays">
        <span *ngFor="let wd of weekdayLabels">{{ wd }}</span>
      </div>
      <div class="calendar-grid">
        <button
          type="button"
          *ngFor="let d of calendarDays"
          class="calendar-day"
          [class.out-of-month]="!d.inMonth"
          [class.today]="d.isToday"
          [class.selected]="d.isSelected"
          (click)="selectDay(d, openCalendarFor)"
        >
          {{ d.day }}
        </button>
      </div>
    </div>
  `,
  styles: [`
    .date-filter-panel {
      padding: 10px;
      min-width: 120px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      background: #fff;
      border-radius: 8px;
      font-family: 'Lato', sans-serif;
      position: relative;
    }
    .date-filter-select,
    .date-filter-input {
      font-size: 12px;
      font-family: 'Lato', sans-serif;
      padding: 10px 12px;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      color: #1a1a2e;
      background: #fff;
    }
    .date-filter-field {
      display: flex;
      flex-direction: column;
      gap: 6px;
      position: relative;
    }
    .date-filter-field-label {
      font-size: 12px;
      font-family: 'Lato', sans-serif;
      color: #64748b;
    }
    .date-filter-input-row {
      display: flex;
      gap: 6px;
      align-items: stretch;
    }
    .date-filter-input-row .date-filter-input {
      flex: 1;
      min-width: 0;
    }
    .btn-calendar {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      flex-shrink: 0;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      background: #fff;
      color: #64748b;
      cursor: pointer;
    }
    .btn-calendar:hover {
      background: #f1f5f9;
    }
    .btn-calendar.active {
      color: #3B82F6;
      border-color: #3B82F6;
    }
    /*
      position: fixed + high z-index so this renders above ag-Grid's
      filter popup (which otherwise clips/scrolls an absolutely
      positioned child). top/left are set inline per-instance via
      popupTop/popupLeft, computed in toggleCalendar().
    */
    .calendar-popup {
      position: fixed;
      z-index: 10000;
      background: #fff;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
      padding: 10px;
      width: 240px;
      font-family: 'Lato', sans-serif;
    }
    .calendar-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
    }
    .calendar-title {
      font-size: 13px;
      font-weight: 600;
      color: #1a1a2e;
    }
    .calendar-nav {
      border: none;
      background: transparent;
      cursor: pointer;
      font-size: 16px;
      line-height: 1;
      color: #64748b;
      padding: 4px 8px;
      border-radius: 4px;
    }
    .calendar-nav:hover {
      background: #f1f5f9;
      color: #1a1a2e;
    }
    .calendar-weekdays {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      margin-bottom: 4px;
    }
    .calendar-weekdays span {
      font-size: 11px;
      color: #94a3b8;
      text-align: center;
    }
    .calendar-grid {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 2px;
    }
    .calendar-day {
      border: none;
      background: transparent;
      font-size: 12px;
      font-family: 'Lato', sans-serif;
      color: #1a1a2e;
      padding: 6px 0;
      border-radius: 6px;
      cursor: pointer;
    }
    .calendar-day:hover {
      background: #f1f5f9;
    }
    .calendar-day.out-of-month {
      color: #cbd5e1;
    }
    .calendar-day.today {
      font-weight: 700;
      color: #3B82F6;
    }
    .calendar-day.selected {
      background: #3B82F6;
      color: #fff;
    }
    .calendar-day.selected:hover {
      background: #3B82F6;
    }
    .date-filter-error {
      font-size: 12px;
      font-family: 'Lato', sans-serif;
      color: #dc2626;
    }
    .date-filter-actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      margin-top: 4px;
    }
    .date-filter-actions button {
      font-size: 14px;
      font-family: 'Lato', sans-serif;
      padding: 8px 20px;
      cursor: pointer;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      background: #fff;
      font-weight: 500;
    }
    .date-filter-actions .btn-reset {
      color: #1a1a2e;
    }
    .date-filter-actions .btn-apply {
      color: #3B82F6;
      border-color: #cbd5e1;
    }
    .date-filter-actions button:hover {
      background: #f1f5f9;
    }
  `]
})
export class DateFilterComponent implements IFilterAngularComp, AfterViewInit, OnDestroy {
  // The calendar popup element is moved out to document.body at runtime
  // (see ngAfterViewInit) so that `position: fixed` positions it relative
  // to the viewport. Without this, if any ancestor (e.g. ag-Grid's own
  // filter popup container) has a CSS `transform`, `filter`, or
  // `will-change: transform`, `position: fixed` on a descendant is
  // computed relative to THAT ancestor instead of the viewport — which
  // is what was causing the calendar to render far from the button.
  @ViewChild('calendarPopup') private calendarPopupRef!: ElementRef<HTMLElement>;

  constructor(private renderer: Renderer2, private elementRef: ElementRef<HTMLElement>) {}

  ngAfterViewInit(): void {
    this.renderer.appendChild(document.body, this.calendarPopupRef.nativeElement);
  }

  ngOnDestroy(): void {
    const node = this.calendarPopupRef?.nativeElement;
    if (node?.parentNode) {
      node.parentNode.removeChild(node);
    }
  }

  private params!: DateFilterParams;
  private hidePopup: (() => void) | null = null;

  typeOptions: DateFilterType[] = DEFAULT_TYPE_OPTIONS;
  type: DateFilterType = 'equals';
  fromText = '';
  toText = '';
  error = '';

  private appliedModel: DateFilterModel | null = null;

  // Calendar popup state. Only one of 'from' / 'to' is open at a time;
  // viewYear/viewMonth track whichever month is currently displayed,
  // seeded from the relevant text field (or today) when opened.
  openCalendarFor: 'from' | 'to' | null = null;
  viewYear = new Date().getFullYear();
  viewMonth = new Date().getMonth(); // 0-11
  readonly weekdayLabels = WEEKDAY_LABELS;

  // Viewport coordinates (px) the calendar popup is pinned to. Computed
  // fresh each time the popup is opened, from the triggering button's
  // real position on screen — see toggleCalendar().
  popupTop = 0;
  popupLeft = 0;
  private static readonly POPUP_WIDTH = 240;

  // Operators like "blank"/"notBlank" don't take a date value at all —
  // no point showing a date input the operator won't use.
  get needsDateInput(): boolean {
    return this.type !== 'blank' && this.type !== 'notBlank';
  }

  get monthLabel(): string {
    return MONTH_LABELS[this.viewMonth];
  }

  // Builds the 6x7 day grid for the currently-viewed month, including
  // the trailing/leading days from adjacent months needed to fill the
  // grid, and flags today/selected so the template can style them.
  get calendarDays(): CalendarDay[] {
    const selected = this.parse(this.openCalendarFor === 'to' ? this.toText : this.fromText);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const firstOfMonth = new Date(this.viewYear, this.viewMonth, 1);
    const startOffset = firstOfMonth.getDay(); // 0 = Sunday
    const gridStart = new Date(this.viewYear, this.viewMonth, 1 - startOffset);

    const days: CalendarDay[] = [];
    for (let i = 0; i < 42; i++) {
      const date = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
      date.setHours(0, 0, 0, 0);
      days.push({
        date,
        day: date.getDate(),
        inMonth: date.getMonth() === this.viewMonth,
        isToday: date.getTime() === today.getTime(),
        isSelected: !!selected && date.getTime() === selected.getTime(),
      });
    }
    return days;
  }

  agInit(params: DateFilterParams): void {
    this.params = params;
    // Whatever the column def hands us in filterOptions — verbatim, same
    // order — becomes the dropdown. Only fall back to our own default
    // list (Equals / Does not equal / After / Before / Between) if none
    // was passed at all.
    this.typeOptions =
      params.filterOptions && params.filterOptions.length > 0
        ? params.filterOptions
        : DEFAULT_TYPE_OPTIONS;
    this.type = this.typeOptions[0] ?? 'equals';
  }

  afterGuiAttached(params?: IAfterGuiAttachedParams): void {
    this.hidePopup = params?.hidePopup ?? null;
  }

  labelFor(type: DateFilterType): string {
    return KNOWN_LABELS[type] ?? humanize(type);
  }

  onTypeChange(): void {
    this.error = '';
    this.closeCalendar();
  }

  // Opens the calendar, positioned in *viewport* coordinates (fixed),
  // anchored just below the input row that contains the clicked button.
  // Using the button's real getBoundingClientRect() — rather than CSS
  // absolute positioning relative to the (small, clipping) ag-Grid
  // filter popup container — is what lets the calendar float freely
  // above everything instead of being squeezed/scrolled inside it.
  toggleCalendar(which: 'from' | 'to', event: MouseEvent): void {
    if (this.openCalendarFor === which) {
      this.closeCalendar();
      return;
    }

    const seedText = which === 'to' ? this.toText : this.fromText;
    const seed = this.parse(seedText) ?? new Date();
    this.viewYear = seed.getFullYear();
    this.viewMonth = seed.getMonth();

    const target = event.currentTarget as HTMLElement;
    const row = (target.closest('.date-filter-input-row') as HTMLElement) ?? target;
    const rect = row.getBoundingClientRect();

    let left = rect.left;
    const maxLeft = window.innerWidth - DateFilterComponent.POPUP_WIDTH - 8;
    if (left > maxLeft) {
      left = Math.max(8, maxLeft);
    }

    this.popupTop = rect.bottom + 6;
    this.popupLeft = left;
    this.openCalendarFor = which;
  }

  closeCalendar(): void {
    this.openCalendarFor = null;
  }

  // A fixed-position popup won't track the anchor if the page (or the
  // ag-Grid popup container) scrolls or the window resizes underneath
  // it, so just close it rather than let it drift out of place.
  @HostListener('window:scroll')
  onWindowScroll(): void {
    if (this.openCalendarFor) {
      this.closeCalendar();
    }
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    if (this.openCalendarFor) {
      this.closeCalendar();
    }
  }

  // Closes the calendar on any click outside both the filter panel and
  // the (now body-attached) calendar popup itself. This also covers the
  // "filter popup closed -> calendar should close too" case: whatever
  // click causes ag-Grid to dismiss its own filter popup is, by
  // definition, outside this component, so it lands here as well.
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.openCalendarFor) return;

    const target = event.target as Node;
    const insideHost = this.elementRef.nativeElement.contains(target);
    const insidePopup = this.calendarPopupRef?.nativeElement.contains(target);
    if (!insideHost && !insidePopup) {
      this.closeCalendar();
    }
  }

  prevMonth(): void {
    if (this.viewMonth === 0) {
      this.viewMonth = 11;
      this.viewYear -= 1;
    } else {
      this.viewMonth -= 1;
    }
  }

  nextMonth(): void {
    if (this.viewMonth === 11) {
      this.viewMonth = 0;
      this.viewYear += 1;
    } else {
      this.viewMonth += 1;
    }
  }

  selectDay(d: CalendarDay, which: 'from' | 'to' | null): void {
    if (!which) return;
    const formatted = this.formatForDisplay(d.date);
    if (which === 'from') {
      this.fromText = formatted;
    } else {
      this.toText = formatted;
    }
    this.error = '';
    this.closeCalendar();
  }

  // Digits-only auto-formatting: strips anything non-numeric as the user
  // types and re-inserts the "/" separators itself — so what's shown is
  // always mm/dd/yyyy, built by us, never handed off to a native control
  // whose format would otherwise depend on the browser/OS locale.
  onDateInput(event: Event, which: 'from' | 'to'): void {
    const input = event.target as HTMLInputElement;
    const digits = input.value.replace(/\D/g, '').slice(0, 8);

    let formatted = digits;
    if (digits.length > 4) {
      formatted = `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
    } else if (digits.length > 2) {
      formatted = `${digits.slice(0, 2)}/${digits.slice(2)}`;
    }

    input.value = formatted;
    if (which === 'from') {
      this.fromText = formatted;
    } else {
      this.toText = formatted;
    }
    this.error = '';
  }

  // Strict mm/dd/yyyy parse — rejects anything that isn't a real
  // calendar date (e.g. 02/31/2026) rather than silently rolling it
  // over to March like `new Date(...)` would.
  private parse(text: string): Date | null {
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text.trim());
    if (!match) return null;

    const month = Number(match[1]);
    const day = Number(match[2]);
    const year = Number(match[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;

    const date = new Date(year, month - 1, day);
    if (date.getMonth() !== month - 1 || date.getDate() !== day || date.getFullYear() !== year) {
      return null;
    }
    return date;
  }

  private toApiDateTime(date: Date, endOfDay = false): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    const time = endOfDay ? '23:59:59' : '00:00:00';
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${time}`;
  }

  isFilterActive(): boolean {
    return this.appliedModel != null;
  }

  // Not used for actual filtering — this grid runs the infinite row
  // model with server-side filtering, so the backend does the real
  // comparison against getModel()'s output. Implemented anyway since
  // AG Grid requires it on the interface, and as a harmless fallback if
  // ever swapped to a client-side row model.
  doesFilterPass(params: IDoesFilterPassParams): boolean {
    if (!this.appliedModel) return true;
    const raw = this.params.getValue(params.node);

    if (this.appliedModel.type === 'blank') return !raw;
    if (this.appliedModel.type === 'notBlank') return !!raw;
    if (!raw) return false;

    const cellDate = new Date(raw);
    cellDate.setHours(0, 0, 0, 0);
    const from = new Date(this.appliedModel.dateFrom.slice(0, 10));

    switch (this.appliedModel.type) {
      case 'equals':
        return cellDate.getTime() === from.getTime();
      case 'notEqual':
        return cellDate.getTime() !== from.getTime();
      case 'lessThan':
        return cellDate.getTime() < from.getTime();
      case 'lessThanOrEqual':
        return cellDate.getTime() <= from.getTime();
      case 'greaterThan':
        return cellDate.getTime() > from.getTime();
      case 'greaterThanOrEqual':
        return cellDate.getTime() >= from.getTime();
      case 'inRange': {
        const to = this.appliedModel.dateTo ? new Date(this.appliedModel.dateTo.slice(0, 10)) : from;
        return cellDate.getTime() >= from.getTime() && cellDate.getTime() <= to.getTime();
      }
      default:
        return true;
    }
  }

  getModel(): DateFilterModel | null {
    return this.appliedModel;
  }

  setModel(model: DateFilterModel | null): void {
    this.appliedModel = model;
    if (!model) {
      this.fromText = '';
      this.toText = '';
      this.type = this.typeOptions[0] ?? 'equals';
      return;
    }

    this.type = model.type;
    if (model.dateFrom) {
      const fromDate = new Date(model.dateFrom.slice(0, 10));
      this.fromText = this.formatForDisplay(fromDate);
    } else {
      this.fromText = '';
    }
    this.toText = model.dateTo ? this.formatForDisplay(new Date(model.dateTo.slice(0, 10))) : '';
  }

  private formatForDisplay(date: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(date.getMonth() + 1)}/${pad(date.getDate())}/${date.getFullYear()}`;
  }

  apply(): void {
    this.error = '';
    this.closeCalendar();

    if (!this.needsDateInput) {
      this.appliedModel = { filterType: 'date', type: this.type, dateFrom: '', dateTo: null };
      this.params.filterChangedCallback();
      this.hidePopup?.();
      return;
    }

    if (!this.fromText.trim()) {
      this.appliedModel = null;
      this.params.filterChangedCallback();
      this.hidePopup?.();
      return;
    }

    const fromDate = this.parse(this.fromText);
    if (!fromDate) {
      this.error = 'Enter a valid date as mm/dd/yyyy.';
      return;
    }

    let toDate: Date | null = null;
    if (this.type === 'inRange') {
      if (!this.toText.trim()) {
        this.error = 'Enter an end date as mm/dd/yyyy.';
        return;
      }
      toDate = this.parse(this.toText);
      if (!toDate) {
        this.error = 'Enter a valid end date as mm/dd/yyyy.';
        return;
      }
      if (toDate < fromDate) {
        this.error = 'End date must be on or after the start date.';
        return;
      }
    }

    this.appliedModel = {
      filterType: 'date',
      type: this.type,
      dateFrom: this.toApiDateTime(fromDate),
      dateTo: toDate ? this.toApiDateTime(toDate, true) : null,
    };

    this.params.filterChangedCallback();
    this.hidePopup?.();
  }

  clear(): void {
    this.error = '';
    this.fromText = '';
    this.toText = '';
    this.appliedModel = null;
    this.closeCalendar();
    this.params.filterChangedCallback();
    this.hidePopup?.();
  }
}