import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LayoutComponent } from '../../../layout/layout/layout';
import { Router } from '@angular/router';
import { Service } from '../../../dashboard/service';
import { AgGridAngular } from 'ag-grid-angular';
import { DatePipe } from '@angular/common';
import { DateFilterComponent } from '../../../date-filter';

import {
  ColDef,
  GridApi,
  GridReadyEvent,
  IGetRowsParams,
  IDatasource,
  ModuleRegistry,
  AllCommunityModule,
  InfiniteRowModelModule,
  RowModelType
} from 'ag-grid-community';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';

ModuleRegistry.registerModules([AllCommunityModule, InfiniteRowModelModule]);

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, LayoutComponent, AgGridAngular],
  templateUrl: './dashboard.html',
  styleUrls: ['./dashboard.css'],
  providers: [DatePipe]
})
export class DashboardComponent implements OnInit, OnDestroy {

  constructor(private router: Router, private service: Service, private datePipe: DatePipe) {}

  // ── AG Grid ───────────────────────────────────────────
  rowModelType: RowModelType = 'infinite';
  PAGE_SIZE = 20;
  cacheOverflowSize = 2;
  maxConcurrentDatasourceRequests = 2;
  infiniteInitialRowCount = 1;
  maxBlocksInCache = 2;
  pagination = true;
  paginationPageSizeSelector = [20, 50, 100];

  loading = false;
  initialLoad = true;
  gridApi!: GridApi;
  private isGridReady = false;

  columnDefs: ColDef[] = [];

  defaultColDef: ColDef = {
    sortable:   true,
    filter:     true,
    resizable:  true,
    suppressMovable: true,
    minWidth: 182,
    filterParams: {
      maxNumConditions:         1,
      suppressAndOrCondition:   true,
      suppressConditionAndButton: true,
      buttons:       ['reset', 'apply'],
      closeOnApply:  true,
      filterOptions: [
        'contains',
        'notContains',
        'equals',
        'notEqual',
        'startsWith',
        'endsWith'
      ]
    }
  };

  overlayNoRowsTemplate = `
    <span class="custom-no-rows">
      ❌ No data found
    </span>
  `;
  overlayLoadingTemplate = `
  <div class="custom-loading-overlay">
    <div class="ag-custom-loading-cell" style="display: flex; align-items: center; gap: 6px; padding-left: 10px; line-height: 25px;">
      <img src="/Images/loader.gif" alt="Loading..." style="width: 150px; height: 150px;" />
      <span>Loading...</span>
    </div>
  </div>`;

  // ── Search ────────────────────────────────────────────
  // [quickFilterText] does NOT work under the infinite row model (it only
  // searches rows already cached in-browser). Instead we send searchQuery
  // to the backend as its own field (quickSearch) on every getRows() call,
  // same as filterModel/sortModel — see buildRequestBody().
  searchQuery = '';
  private searchSubject = new Subject<string>();
  private searchSub?: Subscription;

  // Bumped to _v2: filterOperations on the backend switched from invented
  // snake_case names (not_contains, after, between, ...) to AG Grid's own
  // operator keys (notContains, greaterThan, inRange, ...). Any filter
  // state persisted under the old key would carry stale operator names
  // that no longer match anything server-side, so we key it separately
  // rather than silently misinterpreting old sessionStorage entries.
  private static readonly FILTER_STORAGE_KEY = 'dashboard_grid_filter_state_v2';

  /** Builds the filterModel sent to the backend. AG Grid's filter model
   *  and the backend's expected operator vocabulary are now the same
   *  (both AG Grid-native: notContains, greaterThan, inRange, ...), so
   *  this is a straight passthrough — no operator renaming needed. */
  private buildFilterModelForApi() {
    const raw = this.gridApi?.getFilterModel() || {};
    const finalModel: any = {};
    Object.keys(raw).forEach(colId => {
      const model = raw[colId];
      if (!model) return;
      if (model.filter == null && model.dateFrom == null && model.dateTo == null) return;
      finalModel[colId] = model;
    });
    return finalModel;
  }

  private loadSavedFilterState(): { search: string; filterModel: any } | null {
    try {
      const raw = sessionStorage.getItem(DashboardComponent.FILTER_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  private persistFilterState(): void {
    try {
      const state = {
        search: this.searchQuery,
        filterModel: this.gridApi ? this.gridApi.getFilterModel() : null
      };
      sessionStorage.setItem(DashboardComponent.FILTER_STORAGE_KEY, JSON.stringify(state));
    } catch {
      // sessionStorage unavailable — filters just won't persist, nothing else breaks.
    }
  }

  onFilterChanged(): void {
    this.persistFilterState();
  }

  /** Fired on every keystroke via (ngModelChange). Just pushes into the
   *  debounced subject below — the actual persist + refetch happens once
   *  typing pauses, in the searchSubject subscription. */
  onSearchChange(): void {
    this.searchSubject.next(this.searchQuery);
  }

  // ── Role-Based Access Control ─────────────────────────
  currentUserRole: string = sessionStorage.getItem('roleName') ?? '';

  get canCreateConcept(): boolean {
    return ['Ideation Requestor', 'QA', 'Manager'].includes(this.currentUserRole);
  }

  // ── Stat values ───────────────────────────────────────
  totalConcepts      = 0;
  newConcepts        = 0;
  conceptsInProgress = 0;
  pendingApprovals   = 0;
  qaScheduled        = 0;
  productionReady    = 0;

  get totalConceptsDisplay(): string {
    return this.totalConcepts.toLocaleString();
  }

  // ── Lifecycle ─────────────────────────────────────────
  ngOnInit(): void {
    const saved = this.loadSavedFilterState();
    if (saved?.search) {
      this.searchQuery = saved.search;
      // Restored BEFORE the grid's first getRows() fires, so the very
      // first fetch already carries the right quickSearch value — no
      // separate "hasSavedSearch" bootstrap branch needed the way
      // filterModel required, since search doesn't depend on columns
      // existing first.
    }

    this.searchSub = this.searchSubject.pipe(
      debounceTime(300),
      distinctUntilChanged()
    ).subscribe(() => {
      this.persistFilterState();
      this.refreshGridData();
    });
  }

  ngOnDestroy(): void {
    // Only unsubscribes the RxJS debounce stream — does NOT touch gridApi,
    // so this doesn't reintroduce the teardown race the class comments
    // warn about elsewhere.
    this.searchSub?.unsubscribe();
  }

  /** Forces AG Grid to discard its cached blocks and refetch from row 0
   *  with the current filterModel/quickSearch — the correct way to apply
   *  a "global" change like search under the infinite row model, since
   *  there's no per-column filter instance to hang it off of.
   *  refreshInfiniteCache() is the current (v31+) API name; older
   *  versions used purgeInfiniteCache() — fall back if needed. */
  private refreshGridData(): void {
    if (!this.gridApi) return;
    const api: any = this.gridApi;
    if (typeof api.refreshInfiniteCache === 'function') {
      api.refreshInfiniteCache();
    } else if (typeof api.purgeInfiniteCache === 'function') {
      api.purgeInfiniteCache();
    } else {
      this.setDatasource();
    }
  }

  onGridReady(event: GridReadyEvent): void {
    this.gridApi = event.api;
    this.isGridReady = true;

    const saved = this.loadSavedFilterState();
    const hasSavedFilter = !!(saved?.filterModel && Object.keys(saved.filterModel).length > 0);

    if (hasSavedFilter && this.columnDefs.length === 0) {
      this.bootstrapColumnsThenStart();
    } else if (hasSavedFilter) {
      this.applySavedFilterThenStart();
    } else {
      this.setDatasource();
    }
  }

  private bootstrapColumnsThenStart(): void {
    this.loading = true;

    this.service.getdashboardConcepts(this.buildRequestBody(1, 1, [])).subscribe({
      next: (res) => {
        this.totalConcepts      = res.stats.totalConcepts;
        this.newConcepts        = res.stats.newConcepts;
        this.conceptsInProgress = res.stats.conceptsInProgress;
        this.pendingApprovals   = res.stats.pendingApprovals;
        this.qaScheduled        = res.stats.qaScheduled;
        this.productionReady    = res.stats.productionReady;

        this.columnDefs = this.buildColumnDefsFromMetadata(res.columnMetadata);
        this.gridApi.setGridOption('columnDefs', this.columnDefs);

        this.applySavedFilterThenStart();
      },
      error: () => {
        this.loading = false;
        this.initialLoad = false;
        console.error('Failed to load dashboard columns.');
        this.setDatasource();
      }
    });
  }

  private applySavedFilterThenStart(): void {
    const saved = this.loadSavedFilterState();

    if (saved?.filterModel && Object.keys(saved.filterModel).length > 0) {
      const result: any = this.gridApi.setFilterModel(saved.filterModel);
      if (result && typeof result.then === 'function') {
        result.then(() => this.setDatasource());
      } else {
        this.setDatasource();
      }
    } else {
      this.setDatasource();
    }
  }

  /** Central place building the request body sent to the backend — keeps
   *  page/filterModel/sortModel/quickSearch construction identical whether
   *  called from bootstrap or the real datasource. */
  private buildRequestBody(page: number, pageSize: number, sortModel: any[]) {
    return {
      page,
      page_size: pageSize,
      sortModel,
      filterModel: this.buildFilterModelForApi(),
      quickSearch: this.searchQuery?.trim() || ''
    };
  }

  setDatasource(): void {
  this.loading = true;

  const datasource: IDatasource = {
    getRows: (params: IGetRowsParams) => {
      const startRow = params.startRow;
      const currentPage = Math.floor(startRow / this.PAGE_SIZE) + 1;

      this.loading = true;

      // Only trigger AG Grid's own loading overlay for fetches AFTER the
      // first one. On the very first load, initialLoad is still true and
      // our custom "Loading concepts…" element already covers the grid —
      // letting the grid ALSO call showLoadingOverlay() here stacked a
      // second "Loading..." underneath it, which is what was still
      // visible in the screenshot.
      if (!this.initialLoad) {
        this.gridApi.setGridOption('loading', true);
        this.gridApi.showLoadingOverlay();
      }

      const requestBody = this.buildRequestBody(currentPage, this.PAGE_SIZE, params.sortModel);

      this.service.getdashboardConcepts(requestBody).subscribe({
        next: (res: any) => {
          this.totalConcepts      = res.stats.totalConcepts;
          this.newConcepts        = res.stats.newConcepts;
          this.conceptsInProgress = res.stats.conceptsInProgress;
          this.pendingApprovals   = res.stats.pendingApprovals;
          this.qaScheduled        = res.stats.qaScheduled;
          this.productionReady    = res.stats.productionReady;

          if (res?.columnMetadata && this.columnDefs.length === 0) {
            this.columnDefs = this.buildColumnDefsFromMetadata(res.columnMetadata);
            this.gridApi.setGridOption('columnDefs', this.columnDefs);
          }

          const rows = res?.data ?? [];
          const totalCount = res?.totalCount ?? 0;
          params.successCallback(rows, totalCount);
          this.gridApi.setGridOption('loading', false);
          this.loading = false;
          this.initialLoad = false;   // from here on, grid overlay alone is used

          if (rows.length === 0) {
            this.gridApi.showNoRowsOverlay();
          } else {
            this.gridApi.hideOverlay();
          }
        },
        error: () => {
          this.loading = false;
          this.initialLoad = false;
          this.gridApi.hideOverlay();
          this.gridApi.setGridOption('loading', false);
          params.failCallback();
          console.error('Failed to load dashboard concepts.');
        }
      });
    }
  };

  this.gridApi.setGridOption('datasource', datasource);
}
  private buildColumnDefsFromMetadata(metadata: any): ColDef[] {
    const orderedFields: string[] = Object.keys(metadata || {});

    return orderedFields.map((field: string) => {
      const meta = metadata[field] || {};
      const isDateColumn = meta.type === 'date';

      const filter: ColDef['filter'] =
        meta.type === 'date' ? DateFilterComponent :
        meta.type === 'number' || meta.type === 'float' ? 'agNumberColumnFilter' :
        'agTextColumnFilter';

      // meta.filterOperations now arrives already using AG Grid's own
      // operator keys (notContains, greaterThan, inRange, ...) — passed
      // straight through to filterOptions, no translation needed.
      const filterParams = isDateColumn
        ? {
            ...this.defaultColDef.filterParams,
            filterOptions: meta.filterOperations || [
              'equals', 'notEqual', 'lessThan', 'greaterThan', 'inRange'
            ]
          }
        : {
            ...this.defaultColDef.filterParams,
            filterOptions: meta.filterOperations
          };

      const column: ColDef = {
        field,
        colId: field,
        headerName: field.replace(/_/g, ' '),
        sortable: true,
        resizable: true,
        suppressMovable: true,
        minWidth: 182,
        flex: 1,
        filter,
        filterParams,
        valueGetter: (p: { data: { [x: string]: any } }) => p.data?.[field]
      };

      if (field === 'Concept Name') {
        column.cellStyle = {
          color: '#2563eb',
          cursor: 'pointer',
          fontWeight: '600',
          textDecoration: 'underline'
        };
      }

      if (isDateColumn) {
  column.valueFormatter = (params) => {
    return this.datePipe.transform(params.value, 'MM/dd/yyyy') ?? '';
  };

  column.filterParams = {
    ...column.filterParams,
    comparator: (filterLocalDateAtMidnight: Date, cellValue: string) => {
      if (!cellValue) return -1;

      const cellDate = new Date(cellValue);
      cellDate.setHours(0, 0, 0, 0);

      if (cellDate.getTime() === filterLocalDateAtMidnight.getTime()) {
        return 0;
      }

      return cellDate < filterLocalDateAtMidnight ? -1 : 1;
    }
  };
}

      return column;
    });
  }

  onPaginationChanged(): void {
    if (!this.gridApi) return;

    const newPageSize = this.gridApi.paginationGetPageSize();
    if (!this.isGridReady) return;

    if (newPageSize !== this.PAGE_SIZE) {
      this.PAGE_SIZE = newPageSize;
      this.setDatasource();
    }
  }

  onAddNewConcept(): void {
    if (!this.canCreateConcept) return;
    this.router.navigate(['/concept-create']);
  }

  onGridCellClicked(event: any): void {
    if (event.colDef.field === 'Concept Name') {
      this.router.navigate(['/concept-create', event.data.Concept_Id]);
    }
  }
}