import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LayoutComponent } from '../../../layout/layout/layout';
import { Router } from '@angular/router';
import { Service } from '../../../dashboard/service';
import { AgGridAngular } from 'ag-grid-angular';
import { AllCommunityModule, ColDef, ModuleRegistry } from 'ag-grid-community';

ModuleRegistry.registerModules([AllCommunityModule]);

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, LayoutComponent, AgGridAngular],
  templateUrl: './dashboard.html',
  styleUrls: ['./dashboard.css']
})
export class DashboardComponent implements OnInit {

  constructor(private router: Router, private service: Service) {}

  // ── AG Grid ───────────────────────────────────────────
  pagination                = true;
  paginationPageSize        = 20;
  paginationPageSizeSelector = [20, 50, 100];
  rowData: any[]            = [];
  columnDefs: ColDef[]      = [];

  defaultColDef: ColDef = {
    sortable:   true,
    filter:     true,
    resizable:  true,
    filterParams: {
      maxNumConditions:         1,
      suppressAndOrCondition:   true,
      suppressConditionAndButton: true,
      buttons:       ['reset', 'apply'],
      closeOnApply:  true
    }
  };

  // ── Search ────────────────────────────────────────────
  searchQuery = '';

  // ── State ─────────────────────────────────────────────
  loading = false;

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
    this.loadConcepts();
  }

  private loadConcepts(): void {
    this.loading = true;

    this.service.getdashboardConcepts().subscribe({
      next: (res) => {
        // Stats
        this.totalConcepts      = res.stats.totalConcepts;
        this.newConcepts        = res.stats.newConcepts;
        this.conceptsInProgress = res.stats.conceptsInProgress;
        this.pendingApprovals   = res.stats.pendingApprovals;
        this.qaScheduled        = res.stats.qaScheduled;
        this.productionReady    = res.stats.productionReady;

        // Build columns dynamically from API
        this.columnDefs = res.columns.map((col: any) => {
          const column: ColDef = {
            field:      col.field,
            headerName: col.headerName,
            sortable:   true,
            filter:     true,
            resizable:  true,
            flex:       1
          };

          // Clickable concept name
          if (col.field === 'ConceptName') {
            column.cellStyle = {
              color:          '#2563eb',
              cursor:         'pointer',
              fontWeight:     '600',
              textDecoration: 'underline'
            };
          }

          // Format date columns
          if (col.field === 'CreatedDate' || col.field === 'UpdatedDate') {
            column.valueFormatter = (params) =>
              params.value ? new Date(params.value).toLocaleDateString() : '';
          }

          return column;
        });

        // Bind row data
        this.rowData = res.data || [];
        this.loading = false;
      },
      error: (err) => {
        console.error('Failed to load concepts:', err);
        this.loading = false;
      }
    });
  }

  // ── Actions ───────────────────────────────────────────
  onAddNewConcept(): void {
    this.router.navigate(['/concept-create']);
  }

  onGridCellClicked(event: any): void {
    if (event.colDef.field === 'ConceptName') {
      this.router.navigate(['/concept-create', event.data.ConceptId]);
    }
  }
}