import { Component, OnInit, ViewChild, ElementRef, ChangeDetectorRef, OnDestroy } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { FormsModule } from '@angular/forms';
import { LayoutComponent } from "../../../layout/layout/layout";
import { ToastrService } from 'ngx-toastr';
import { Service } from '../../../dashboard/service';
import { DomSanitizer, SafeHtml, SafeResourceUrl } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import * as mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import { Subscription } from 'rxjs';


interface User { id: string; name: string; }
interface Owner { id: string; name: string; initials: string; avatarColor: string; department: string; }
interface Tab { key: string; label: string; }

interface OwnerCandidate {
  id: string;
  name: string;
  department: string;
  initials: string;
  avatarColor: string;
}

interface DevNote {
  id: string;
  author: string;
  initials: string;
  avatarBg: string;
  time: string;
  text: string;
  RoleName:string;
  /** true once this note has actually been saved to the backend (loaded
   *  from the API, or confirmed sent in a previous submit). Only notes
   *  with persisted === false get included in the next submit's
   *  developmentNotes payload — otherwise every Update re-sends (and the
   *  backend re-inserts) every note that already exists, duplicating them
   *  on every save. */
  persisted: boolean;
}

interface AttachFile {
  id: string;             // stable identity for progress updates — object refs change on each tick
  name: string;
  size: number;
  progress: number;
  file: File;
  downloadUrl?: string;   // set when restored from a saved concept (for fetching real bytes on view)
  /** Backend AttachmentId — set only for files restored from a saved
   *  concept. Undefined for a file just picked this session, since it
   *  has no backend record yet. Drives whether removeAttachment() needs
   *  to call the delete API or can just drop it from the local array. */
  attachmentId?: number;
}

interface SupportingDoc {
  name: string;
  sourceurl: string;
  pdfLocation: string;
  uploadProgress: number;
  file: File | null;
  downloadUrl?: string;   // set when restored from a saved concept — GET /api/download-attachment/{id}
  restored?: boolean;     // true when this card was filled from a saved concept, not just uploaded this session
  /** Last known FileName/FileSize from the backend for this slot, captured
   *  on restore. `file` for a restored doc is just a zero-byte placeholder
   *  (see patchSupportingDocs), so when the slot is resubmitted without a
   *  newly-picked file, these are what tell the backend "this slot's
   *  existing file is still intact" — otherwise the update looks
   *  file-less and the backend can wipe the file association on its end
   *  (see onDocSubmit's resolveDocFileMeta()). */
  originalFileName?: string;
  originalFileSize?: number;
  /** Backend AttachmentId for this slot — set only when restored from a
   *  saved concept. Undefined for a slot added/filled this session that
   *  was never submitted, since there's no backend record to delete yet.
   *  Drives whether removeSupportingDoc() needs to call the delete API. */
  attachmentId?: number;
}

interface SheetData {
  sheetName: string;
  headers: string[];
  rows: any[][];
}

interface LatestConceptItem {
  /** Stable anchor id — PK of ConceptKeys/Concepts, never changes across
   *  edits. This is what must be used for routing and for this.conceptId,
   *  never CurrentConceptId (see onSelectLatestConcept). Requires the
   *  backend list endpoint (getConceptsByUserId) to select this column. */
  ConceptId: string;
  /** Display/version id (…_D001 → …_D002 → …_D003, or the finalized
   *  production id). Changes on every dev edit — label/display only,
   *  never send this back to the backend as concept_id. */
  CurrentConceptId: string;
  ConceptName: string;
  DevelopmentStatus: string;
  CreatedDate: string;
  statusClass?: string;
  RecordType?: string;
  isDraft?: boolean;
  /** Assignment fields used by the "Assigned to me" filter. The
   *  /api/latest-updates response only ever returns the display names
   *  (IdeationRequestor / DataScienceProgrammer) — no id columns — so
   *  isAssignedToCurrentUser() matches purely on username. */
  IdeationRequestor?: string;
  DataScienceProgrammer?: string;
}

interface IdValueOption { id: number; value: string; }
interface ClientOption { client_id: string; client_name: string; }
interface MasterConceptOption { master_id: string; concept_name: string; }
interface ReviewTypeOption { review_type: string; description: string; }
interface ClaimTypeOption { claim_type: string; description: string; }
interface IdeationRequestorOption { id: number; name: string; role_name: string; }
interface DataScienceProgrammerOption { id: number; name: string; role_name?: string; }
interface clientApprovalstatusOption { id: number; value: string }

type AttachCategory = 'specs' | 'table' | 'other' | 'approval';

@Component({
  selector: 'app-concept-create',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule, DatePipe, LayoutComponent],
  templateUrl: './concept-create.html',
  styleUrls: ['./concept-create.css']
})
export class ConceptCreateComponent implements OnInit, OnDestroy  {
  @ViewChild('specsInput') specsInputRef!: ElementRef<HTMLInputElement>;
  @ViewChild('tableInput') tableInputRef!: ElementRef<HTMLInputElement>;
  @ViewChild('otherInput') otherInputRef!: ElementRef<HTMLInputElement>;
  @ViewChild('approvalInput') approvalInputRef!: ElementRef<HTMLInputElement>;
  @ViewChild('fileInput')  fileInput!: ElementRef<HTMLInputElement>;
  @ViewChild('docFileInput') docFileInputRef!: ElementRef<HTMLInputElement>;
  @ViewChild('notesListRef') notesListRef!: ElementRef<HTMLDivElement>;
  private pendingDocIndex: number | null = null;

  // ── Mode ───────────────────────────────────────────────────────────────
  isEditMode = false;
  pageLoading = false;

  // ── Meta ──────────────────────────────────────────────────────────────
  // conceptId is the STABLE ANCHOR — PK of ConceptKeys/Concepts on the
  // backend, never changes across edits. This is what goes in the route
  // and in every submit's concept_id field.
  conceptId   = '';
  // displayConceptId is the version/display id (…_D001 → …_D002 → …_D003,
  // or the finalized production id) — for showing to the user only.
  // NEVER send this back to the backend as concept_id.
  displayConceptId = '';
  createdDate = new Date();
  updatedDate = new Date();

  // ── Section completion flags ─────────────────────────────────────────
  // Each one flips to 1 only when its own tab's Submit button is clicked,
  // and is sent to the backend inside `metadata` in submitConcept().
  developmentCompleted: 0 | 1         = 0;
  clientApprovalCompleted: 0 | 1      = 0;
  supportingDocumentsCompleted: 0 | 1 = 0;
  isDraftConcept = false;

  /** Shown when the user clicks Client Approval / Supporting Document
   *  while the concept is still a draft. Tells them why the click did
   *  nothing instead of relying on the title tooltip alone. */
  showDraftLockBanner = false;
  private draftLockBannerTimer: ReturnType<typeof setTimeout> | null = null;


  // ── Navigation ────────────────────────────────────────────────────────
  searchQuery = '';
  leftPanelCollapsed = false;

  /** "Assigned to me" toggle for the Latest Updates list — when true,
   *  filteredConcepts is narrowed to concepts where the logged-in user
   *  (sessionStorage userId / userName) is the IdeationRequestor or the
   *  DataScienceProgrammer. Combines with the text search below. */
  assignedToMeOnly = false;

  /** Matches a Latest-Updates row against the current session user for
   *  the IdeationRequestor / DataScienceProgrammer roles. The backend
   *  (/api/latest-updates) only ever returns display names for these —
   *  never ids — so this is a case-insensitive name match against
   *  sessionStorage's userName. */
  private isAssignedToCurrentUser(item: LatestConceptItem): boolean {
    const sessionUserName = (sessionStorage.getItem('userName') || '').trim().toLowerCase();
    if (!sessionUserName) {
      return false;
    }

    const requestorName  = (item.IdeationRequestor || '').trim().toLowerCase();
    const programmerName = (item.DataScienceProgrammer || '').trim().toLowerCase();

    return requestorName === sessionUserName || programmerName === sessionUserName;
  }

  get filteredConcepts(): LatestConceptItem[] {
    let list = this.latestConcepts;

    if (this.assignedToMeOnly) {
      list = list.filter(c => this.isAssignedToCurrentUser(c));
    }

    const q = this.searchQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter(c =>
      c.ConceptName?.toLowerCase().includes(q) ||
      c.CurrentConceptId?.toLowerCase().includes(q)    ||
      c.DevelopmentStatus?.toLowerCase().includes(q)
    );
  }
  activeTab   = 'development';

  tabs: Tab[] = [
    { key: 'development', label: 'Concept Development' },
    { key: 'approval',    label: 'Client Approval' },
    { key: 'documents',   label: 'Supporting Document' }
  ];

  // ── Form ──────────────────────────────────────────────────────────────
  form!: FormGroup;

  // ── Reference data ────────────────────────────────────────────────────
  users: User[] = [
    { id: 'u1', name: 'Alice Johnson' },
    { id: 'u2', name: 'Bob Martinez' },
    { id: 'u3', name: 'Carol Singh' },
    { id: 'u4', name: 'David Chen' }
  ];

  owners: Owner[] = [];
  uploadedFiles: File[] = [];

  // ── Ownership dropdown ────────────────────────────────────────────────
  showOwnerDropdown = false;
  ownerSearch       = '';

  ownerCandidates: OwnerCandidate[] = [
    { id: 'p1', name: 'Alice Johnson',  initials: 'AJ', avatarColor: '#6366f1', department: 'Data Science' },
    { id: 'p2', name: 'Bob Martinez',   initials: 'BM', avatarColor: '#8b5cf6', department: 'Engineering'  },
    { id: 'p3', name: 'Carol Singh',    initials: 'CS', avatarColor: '#ec4899', department: 'Product'      },
    { id: 'p4', name: 'David Chen',     initials: 'DC', avatarColor: '#f59e0b', department: 'Analytics'    },
    { id: 'p5', name: 'Emma Williams',  initials: 'EW', avatarColor: '#10b981', department: 'QA'           },
    { id: 'p6', name: 'Frank Torres',   initials: 'FT', avatarColor: '#3b82f6', department: 'Data Science' },
    { id: 'p7', name: 'Grace Kim',      initials: 'GK', avatarColor: '#ef4444', department: 'Engineering'  }
  ];

  latestConcepts: LatestConceptItem[] = [];
  latestUpdatesLoading = false;

  // ── Master data (dropdown sources) ────────────────────────────────────
  developmentStatusOptions: IdValueOption[] = [];
  priorityOptions: IdValueOption[] = [];
  clientOptions: ClientOption[] = [];
  masterConceptOptions: MasterConceptOption[] = [];
  reviewTypeOptions: ReviewTypeOption[] = [];
  claimTypeOptions: ClaimTypeOption[] = [];
  ideationRequestorOptions: IdeationRequestorOption[] = [];
  dataScienceProgrammerOptions: DataScienceProgrammerOption[] = [];
  clientApprovalstatusOptions: clientApprovalstatusOption[] = [];
  masterDataLoading = false;

  // ── Date constraints ──────────────────────────────────────────────────
  /** Today's date in yyyy-MM-dd, used as the [min] bound on QA Schedule /
   *  Production Schedule / Submitted To Client On date pickers so past
   *  dates aren't selectable. */
  minSelectableDate = new Date().toISOString().split('T')[0];

  // ── Locale-independent date display (MM/DD/YYYY) ────────────────────
  /**
   * Native <input type="date"> renders its typed segments using the
   * OS/browser locale (MM/DD/YYYY on one machine, DD/MM/YYYY on another) —
   * there's no HTML attribute that overrides this. QA Schedule, Production
   * Schedule, and Submitted To Client On are instead rendered as plain
   * text inputs that WE format, always as MM/DD/YYYY, paired with a
   * hidden native date input (per field) used only to pop the native
   * calendar via showPicker(). The FormControl itself still always holds
   * a plain 'yyyy-MM-dd' string, exactly as before, so validDateRange /
   * notPastDate and every submit payload are unaffected.
   */

  /** Bound to the visible text box's [value]; always MM/DD/YYYY. */
  getDateDisplay(controlName: string): string {
    return this.isoToDisplayDate(this.form.get(controlName)?.value);
  }

  /** User typed into the visible text box. */
  onDateTextInput(event: Event, controlName: string): void {
    const input = event.target as HTMLInputElement;
    const formatted = this.autoFormatDateInput(input.value);
    input.value = formatted;
    if (formatted.length === 10) {
      const iso = this.displayDateToIso(formatted);
      if (iso) {
        this.form.get(controlName)?.setValue(iso);
      }
    }
  }

  /** Leaving the text box: reconcile — a valid date commits, anything
   *  incomplete/invalid snaps back to whatever the control still holds. */
  onDateTextBlur(event: Event, controlName: string): void {
    const input = event.target as HTMLInputElement;
    const control = this.form.get(controlName);
    const iso = this.displayDateToIso(input.value);
    if (input.value && iso) {
      control?.setValue(iso);
    } else if (input.value) {
      // Incomplete/invalid text left behind — discard it.
      input.value = this.isoToDisplayDate(control?.value);
    }
    control?.markAsTouched();
  }

  /** User picked a date from the native calendar popup. */
  onDateNativeChange(event: Event, controlName: string): void {
    const input = event.target as HTMLInputElement;
    const control = this.form.get(controlName);
    control?.setValue(input.value || '');
    control?.markAsTouched();
  }

  /** Opens the hidden native <input type="date"> calendar for a given
   *  field. Pass the template reference variable of the hidden input. */
  openDatePicker(nativeInput: HTMLInputElement): void {
    if (!nativeInput) return;
    const anyNative = nativeInput as any;
    if (typeof anyNative.showPicker === 'function') {
      try {
        anyNative.showPicker();
        return;
      } catch {
        // fall through to focus/click fallback below
      }
    }
    nativeInput.focus();
    nativeInput.click();
  }

  /** As digits are typed, auto-inserts '/' after MM and DD. */
  private autoFormatDateInput(raw: string): string {
    const digits = raw.replace(/\D/g, '').slice(0, 8); // MMDDYYYY
    let out = '';
    if (digits.length > 0) out += digits.slice(0, 2);
    if (digits.length >= 3) out += '/' + digits.slice(2, 4);
    else if (digits.length > 2) out += '/' + digits.slice(2);
    if (digits.length >= 5) out += '/' + digits.slice(4, 8);
    return out;
  }

  /** 'MM/DD/YYYY' -> 'yyyy-MM-dd', or '' if not a real, complete date. */
  private displayDateToIso(display: string): string {
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(display);
    if (!match) return '';
    const month = parseInt(match[1], 10);
    const day = parseInt(match[2], 10);
    const year = parseInt(match[3], 10);
    if (month < 1 || month > 12 || day < 1 || day > 31) return '';
    const date = new Date(year, month - 1, day);
    // Guard against overflow dates like 02/31/2026 rolling into March.
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
      return '';
    }
    const mm = String(month).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    return `${year}-${mm}-${dd}`;
  }

  /** 'yyyy-MM-dd' -> 'MM/DD/YYYY', or '' if empty/unparseable. */
  private isoToDisplayDate(iso: string | null | undefined): string {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    if (!match) return '';
    const [, year, month, day] = match;
    return `${month}/${day}/${year}`;
  }



  // ── Role-Based Access Control ─────────────────────────────────────────
  /** Raw role string stored in sessionStorage by the auth layer.
   *  Matches one of: 'Ideation Requestor', 'QA User',
   *  'Data Science Programmer', 'Operations', 'Manager', 'Viewer' */
  currentUserRole: string = sessionStorage.getItem('roleName') ?? '';
  // console.log('Current user role:', this.currentUserRole);

  /** Full edit + submit rights. Ideation Requestor, QA User, Manager. */
  get canFullEdit(): boolean {
    return ['Ideation Requestor', 'QA', 'Manager'].includes(this.currentUserRole);
  }
  /** Data Science Programmer — limited field edit + submit, no approval tab. */
  get canDSEdit(): boolean {
    return this.currentUserRole === 'Data Science Programmer';
  }

  /** Any role that can write something (not pure read-only). */
  get canEdit(): boolean {
    return this.canFullEdit || this.canDSEdit;
  }

  /** Only Manager and full-edit roles may submit Client Approval. */
  get canSubmitApproval(): boolean {
    return ['Ideation Requestor', 'QA', 'Manager'].includes(this.currentUserRole);
  }

  /** Pure read-only roles. */
  get isReadOnly(): boolean {
    return ['Operations', 'Viewer'].includes(this.currentUserRole);
  }

  /** Gates every file upload/delete action (Attachments AND Supporting
   *  Documents), not just the form fields. Previously only the form
   *  controls were disabled for read-only/unauthorized roles — the
   *  attach/upload/remove buttons and their underlying handlers had no
   *  permission check at all, so a read-only user could still add or
   *  delete files even though every other field on the page was locked.
   *  'approval' attachments are gated by canSubmitApproval (Client
   *  Approval has its own, narrower permission set) — every other
   *  category (specs/table/other) and Supporting Documents are gated by
   *  the general canEdit. Public so the template can also use it to
   *  hide/disable the relevant buttons, not just block the click. */
  canManageAttachments(cat: AttachCategory): boolean {
    if (this.isReadOnly) return false;
    return cat === 'approval' ? this.canSubmitApproval : this.canEdit;
  }

  /** Same idea as canManageAttachments(), scoped to Supporting Documents —
   *  that tab has no per-category split (it's always gated by canEdit).
   *  Public so the template can hide/disable the add/upload/delete
   *  controls there too. */
  get canManageSupportingDocs(): boolean {
    return !this.isReadOnly && this.canEdit;
  }

  /** Blocks a file action with a consistent toast and returns whether it
   *  was actually blocked, so callers can `if (this.blockIfCannotManage(...)) return;`. */
  private blockIfCannotManage(cat: AttachCategory): boolean {
    if (this.canManageAttachments(cat)) return false;
    this.toastr.error('You do not have permission to upload or delete files.', 'Access Denied');
    return true;
  }

  /** Same idea as blockIfCannotManage(), scoped to Supporting Documents —
   *  that tab has no per-category split (it's always gated by canEdit),
   *  so this just wraps the isReadOnly/canEdit check with the same toast. */
  private blockIfCannotManageDocs(): boolean {
    if (this.canManageSupportingDocs) return false;
    this.toastr.error('You do not have permission to upload or delete files.', 'Access Denied');
    return true;
  }

  /** Statuses the CURRENT role may move THIS concept's status to, given
   *  its current status — fetched from GET /api/allowed-statuses so the
   *  dropdown always matches the backend permission matrix in
   *  status_permissions.py. Populated by refreshAllowedStatuses(). */
  allowedStatusOptions: IdValueOption[] = [];

  /** True when the role has no permitted transitions away from the
   *  concept's current status (e.g. Operations/Viewer, or a role whose
   *  stage has already passed for this concept). Drives disabling the
   *  Development Status select even for roles that can otherwise edit. */
  statusLocked = false;

  /** Re-fetches allowedStatusOptions for the given current status and the
   *  logged-in user's role, then rebuilds the dropdown's option list so it
   *  always contains: (a) every status the role may transition TO, plus
   *  (b) the concept's own current status, so the field never renders
   *  blank/invalid for a value the role isn't allowed to move away from. */
   private lastKnownDevStatus = 'New';
  private refreshAllowedStatuses(currentStatus: string): void {
    this.lastKnownDevStatus = currentStatus || 'New';   
  const userId = Number(sessionStorage.getItem('userId'));

  if (this.isReadOnly || !userId) {
    this.allowedStatusOptions = this.developmentStatusOptions.filter(
      d => d.value === currentStatus
    );
    this.statusLocked = true;
    this.form.get('developmentStatus')?.disable({ emitEvent: false });
    return;
  }

  this.service.getAllowedStatuses(userId, currentStatus || 'New').subscribe({
    next: (res) => {
      this.allowedStatuses = res?.allowed_next_statuses ?? [];

      this.applyAllowedStatusFilter(currentStatus);
    },
    error: () => {
      this.allowedStatusOptions = this.developmentStatusOptions.filter(
        d => d.value === currentStatus
      );
      this.statusLocked = true;
      this.form.get('developmentStatus')?.disable({ emitEvent: false });
    }
  });
}

private applyAllowedStatusFilter(currentStatus: string): void {
  this.allowedStatusOptions = this.developmentStatusOptions.filter(
    d =>
      this.allowedStatuses.includes(d.value) ||
      d.value === currentStatus
  );

  this.statusLocked = this.allowedStatuses.length === 0;

  queueMicrotask(() => {
    const control = this.form.get('developmentStatus');

    if (this.statusLocked || this.isReadOnly) {
      control?.disable({ emitEvent: false });
    } else if (this.canEdit) {
      control?.enable({ emitEvent: false });
    }
  });
}

  /** Disables form controls the current role is not allowed to edit.
 *  Called after patchForm() so Angular's disable() doesn't get
 *  overwritten by patchValue(). Re-called on resetToNewConcept()
 *  for the create flow. */
  private applyRoleRestrictions(): void {
    if (this.isReadOnly) {
      // Disable every control in the form for pure read-only roles.
      Object.keys(this.form.controls).forEach(key => {
        this.form.get(key)?.disable({ emitEvent: false });
      });
      // Also disable the confidence score nested group.
      this.form.get('confidenceScore')?.disable({ emitEvent: false });
      return;
    }

    if (this.canDSEdit) {
      // Data Science Programmer: can only edit estimates, description,
      // dev status, confidence score, schedules, requestor, programmer,
      // halo number, previous report, and notes.
      // Everything else (concept name, client/master/review/claim type) is locked.
      const dsLockedFields = [
        'conceptName', 'clientName', 'masterConceptName',
        'reviewType', 'claimType',
        // Client Approval fields — DS Programmer has no approval access.
        'clientConceptName', 'clientConceptDescription',
        'clientApprovalStatus', 'submittedToClientOn', 'clientApprovalNotes'
      ];
      dsLockedFields.forEach(f => this.form.get(f)?.disable({ emitEvent: false }));

      // These are the fields DS Programmer CAN edit — ensure they're enabled
      // (in case lockCoreFields ran first and over-disabled something).
      const dsEditableFields = [
        'developmentStatus', 'priority', 'haloNumber',
        'Internalconceptdescription', 'estimatedVolume', 'estimatedDollars',
        'ideationRequestor', 'dataScienceProgrammer',
        'previousReportId', 'qaSchedule', 'productionSchedule'
      ];
      dsEditableFields.forEach(f => this.form.get(f)?.enable({ emitEvent: false }));
      this.form.get('confidenceScore')?.enable({ emitEvent: false });
    }
    // canFullEdit roles: no extra restrictions beyond lockCoreFields().
  }


  private originalFieldValues: Record<string, any> = {};
  private readonly watchedFields = [
  'developmentStatus',
  'priority',
  'estimatedVolume',
  'estimatedDollars',
  'confidenceScore',   // nested group — handled specially below
  'qaSchedule',
  'productionSchedule',
  'ideationRequestor',
  'dataScienceProgrammer',
  'haloNumber',
  'previousReportId',
  'Internalconceptdescription',
];

  // Attachment categories that live on the Concept Development tab —
  // 'approval' belongs to Client Approval and isn't part of this check.
  private readonly trackedAttachmentCategories: AttachCategory[] = ['specs', 'table', 'other'];

  // Snapshot of AttachmentIds present right after load/refresh, per
  // category — used the same way originalFieldValues is: anything added
  // (no attachmentId yet) or missing from this snapshot counts as a change.
  private originalAttachmentIds: Record<AttachCategory, Set<number>> = {
    specs: new Set(), table: new Set(), other: new Set(), approval: new Set()
  };

  private snapshotAttachmentIds(): void {
    this.originalAttachmentIds = { specs: new Set(), table: new Set(), other: new Set(), approval: new Set() };
    for (const cat of this.trackedAttachmentCategories) {
      this.attachments[cat].forEach(f => {
        if (f.attachmentId) this.originalAttachmentIds[cat].add(f.attachmentId);
      });
    }
  }

  /** True if any specs/table/other attachment has been added or removed
   *  since the last snapshot — mirrors getChangedWatchedFields() but for
   *  attachments instead of form fields. */
  private getAttachmentsChanged(): boolean {
    return this.trackedAttachmentCategories.some(cat => {
      const current = this.attachments[cat];
      const hasNewFile = current.some(f => !f.attachmentId);
      if (hasNewFile) return true;

      const currentIds = new Set(current.filter(f => f.attachmentId).map(f => f.attachmentId!));
      const original = this.originalAttachmentIds[cat];
      if (currentIds.size !== original.size) return true;
      for (const id of original) {
        if (!currentIds.has(id)) return true;
      }
      return false;
    });
  }

  get reversedDocs(): SupportingDoc[] {
    return [...this.supportingDocs].reverse();
  }

  /** Drives the header status badge — falls back to "New" before a
   *  development status has been chosen (e.g. a brand-new concept). */
  get developmentStatusLabel(): string {
    return this.form.get('developmentStatus')?.value || 'New';
  }

  /** CSS-safe slug of the label above, e.g. "In Progress" -> "in-progress",
   *  used as `status-{slug}` so each development status can get its own
   *  badge color (see .status-badge.status-* rules in the stylesheet). */
  get developmentStatusSlug(): string {
    return this.developmentStatusLabel
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }

  get filteredCandidates(): OwnerCandidate[] {
    const q = this.ownerSearch.toLowerCase();
    const addedIds = new Set(this.owners.map(o => o.id));
    return this.ownerCandidates.filter(
      c => !addedIds.has(c.id) && (c.name.toLowerCase().includes(q) || c.department.toLowerCase().includes(q))
    );
  }

  // ── Development Notes ─────────────────────────────────────────────────
  newNoteText = '';
  devNotes: DevNote[] = [];

  // Drives the red outline on the note input — set true when a submit is
  // blocked because tracked fields/attachments changed but no note was
  // entered, cleared as soon as the user starts typing a note.
  noteInputInvalid = false;

  /** Bound to the note input's (input) event — clears the red-outline
   *  state the moment the user starts addressing it. */
  onNoteInputChange(): void {
    if (this.noteInputInvalid) this.noteInputInvalid = false;
  }

  // Logged-in user's display name + initial — used for the "self" avatar
  // on the note composer row and for any note added in this session.
  // NOTE: adjust the sessionStorage key below if the app stores the
  // logged-in user's name under a different key elsewhere.
  currentUserName = sessionStorage.getItem('userName') || 'You';
  currentUserInitial = this.getInitial(this.currentUserName);

  private getInitial(name: string): string {
    return name?.trim()?.charAt(0)?.toUpperCase() || '?';
  }

  // ── Attachments ───────────────────────────────────────────────────────
  attachments: Record<AttachCategory, AttachFile[]> = {
    specs: [],
    table: [],
    other: [],
    approval: []
  };

  // ── Supporting Documents ──────────────────────────────────────────────
  supportingDocs: SupportingDoc[] = [
    { name: '', sourceurl: '', pdfLocation: '', uploadProgress: 0, file: null },
    { name: '', sourceurl: '', pdfLocation: '', uploadProgress: 0, file: null },
    { name: '', sourceurl: '', pdfLocation: '', uploadProgress: 0, file: null }
  ];

  /** True while any specs/table/other attachment's progress bar hasn't
   *  reached 100% yet. Drives [disabled] on Save as Draft / Create
   *  Concept / Update so a click can't fire while a file is still
   *  "uploading" (see simulateUploadProgress). */
  get isAttachmentUploading(): boolean {
    const categories: AttachCategory[] = ['specs', 'table', 'other'];
    return categories.some(cat => this.attachments[cat].some(f => f.progress < 100));
  }

  /** Same idea for the Supporting Documents tab — any doc that has a file
   *  attached but whose progress bar hasn't reached 100% yet blocks Submit. */
  get isSupportingDocUploading(): boolean {
    return this.supportingDocs.some(d => d.file && d.uploadProgress < 100);
  }

  /** Same idea, scoped to the Client Approval tab's own attachment
   *  category — blocks the Approval Submit button while a file there is
   *  still mid-upload, without affecting the Development tab's button. */
  get isApprovalAttachmentUploading(): boolean {
    return this.attachments.approval.some(f => f.progress < 100);
  }

  // ── Upload Modal ──────────────────────────────────────────────────────
  showUploadModal    = false;
  modalSelectedIndex: number | null = null;

  // ── Doc Viewer (Word/Excel/PDF popup) ──────────────────────────────────
  docViewerVisible  = false;
  docViewerFileName = '';
  docViewerFileExt  = '';
  docViewerLoading  = false;
  docWordHtml: SafeHtml = '';
  docSheets: SheetData[] = [];
  docActiveSheet = 0;
  docPdfUrl: SafeResourceUrl | null = null;
  private docPdfObjectUrl: string | null = null;   // raw URL, kept to revoke on close


  private allowedStatuses: string[] = [];

  // ── Submit / Upload state ─────────────────────────────────────────────
  loading = false;

  constructor(
    private fb: FormBuilder,
    private cdr: ChangeDetectorRef,
    private service: Service,
    private toastr: ToastrService,
    private sanitizer: DomSanitizer,
    private route: ActivatedRoute,
    private router: Router
  ) {}


  private routeSub?: Subscription;

  // ── Lifecycle ─────────────────────────────────────────────────────────
  ngOnInit(): void {
    this.buildForm();
    this.loadLatestUpdates();
    this.loadMasterData();
    if (this.activeTab === 'development') {
      // this.loadUserFiles();
    }

    // Re-run whenever the :id route param changes, not just on first load.
    // (Angular reuses this component instance when navigating between
    // /concept-create/:id routes, so ngOnInit itself only fires once —
    // reading route.snapshot here would go stale on subsequent navigations.)
    this.routeSub = this.route.paramMap.subscribe(params => {
      const routeId = params.get('id');
      const queryId = this.route.snapshot.queryParamMap.get('id');
      const id      = routeId ?? queryId;

      if (id) {
        this.isEditMode = true;
        this.conceptId  = id;
        this.loadConcept(id);
      } else {
        this.isEditMode = false;
        this.resetToNewConcept();
      }
    });
  }
  ngOnDestroy(): void {
    this.routeSub?.unsubscribe();
    if (this.draftLockBannerTimer) {
      clearTimeout(this.draftLockBannerTimer);
    }
  }

  // ── Load existing concept ─────────────────────────────────────────────
  // Used for the initial route-driven load — shows the page-level loading
  // state and always lands on the Development tab.
  private loadConcept(id: string): void {
    this.pageLoading = true;
    this.activeTab   = 'development';
    this.fetchAndApplyConcept(id, () => { this.pageLoading = false; }, 'Failed to load concept');
  }

  /** Soft-reload: re-fetches this concept from the server and re-patches
   *  every tab in place right after a successful save/update, so the page
   *  reflects exactly what was persisted (computed dates, server-side
   *  defaults, notes, attachment state, etc.) instead of relying on the
   *  optimistic local mutations made right after the save call. No
   *  page-level loading flag and no tab switch — so it never disrupts
   *  whichever tab the user is currently on — and no full browser page
   *  reload either. */
  private refreshConceptData(id: string): void {
    if (!id) return;
    this.fetchAndApplyConcept(id, undefined, 'Failed to refresh concept');
  }

  /** Shared fetch + patch logic behind loadConcept() and
   *  refreshConceptData() — keeps both call sites in sync with whatever
   *  the form actually needs patched. */
  private fetchAndApplyConcept(id: string, onDone?: () => void, errorMessage: string = 'Failed to load concept'): void {
    this.service.getConcept(id).subscribe({
      next: (res) => {
        const c     = res.concept ?? {};
        const files = res.active_files ?? [];

        this.patchForm(c);
        // this.cdr.detectChanges();
        this.snapshotFieldValues();
        this.lockCoreFields();
        this.applyRoleRestrictions();
        this.refreshAllowedStatuses(c.DevelopmentStatus ?? 'New');
        this.patchMeta(c);
        this.patchAttachments(files);                          // Attachments tab (SPECS / TABLE / OTHER)
        this.snapshotAttachmentIds();
        this.patchSupportingDocs(files);                       // Supporting Documents tab
        this.patchDevNotes(res.development_notes ?? []);       // Development Notes
        this.patchClientApproval(res.client_approvals ?? []);  // Client Approval tab
        this.ensureClientConceptName();
        // this.cdr.detectChanges();
        onDone?.();
      },
      error: (err) => {
        this.toastr.error(errorMessage, 'Error');
        console.error(err);
        onDone?.();
      }
    });
  }
  private snapshotFieldValues(): void {
    this.originalFieldValues = {};
    for (const field of this.watchedFields) {
      if (field === 'confidenceScore') {
        this.originalFieldValues[field] = this.form.get('confidenceScore.value')?.value ?? '';
      } else {
        this.originalFieldValues[field] = this.form.get(field)?.value ?? '';
      }
    }
  }

  private getChangedWatchedFields(): string[] {
    return this.watchedFields.filter(field => {
      const original = this.originalFieldValues[field] ?? '';
      const current  = field === 'confidenceScore'
        ? (this.form.get('confidenceScore.value')?.value ?? '')
        : (this.form.get(field)?.value ?? '');
      return String(current).trim() !== String(original).trim();
    });
  }

  private patchForm(c: any): void {
  this.form.patchValue({
    conceptName:                c.ConceptName                ?? '',
    clientName:                 c.ClientId                   ?? '',
    masterConceptName:          c.MasterConceptId            ?? '',
    reviewType:                 c.ReviewType                 ?? '',
    claimType:                  c.ClaimType                  ?? '',
    Internalconceptdescription: c.InternalConceptDescription ?? '',
    developmentStatus:          c.DevelopmentStatus          ?? '',
    priority:                   c.Priority                   ?? '',
    haloNumber:                 c.HaloNumber                 ?? '',
    estimatedVolume:            c.EstimatedVolume            ?? '',
    estimatedDollars:           c.EstimatedDollars           ?? '',
    previousReportId:           c.PreviousReportId           ?? '',
    qaSchedule:         c.QASchedule         ? c.QASchedule.split('T')[0]         : '',
    productionSchedule: c.ProductionSchedule ? c.ProductionSchedule.split('T')[0] : '',
    ideationRequestor:          c.IdeationRequestorId        ?? '',
    dataScienceProgrammer:      c.DataScienceProgrammerId    ?? '',

    // Client Approval (not present in this payload — keep as-is/blank)
    clientConceptName:        c.ClientConceptName        ?? '',
    clientConceptDescription: c.ClientConceptDescription ?? '',
    clientApprovalStatus:     c.ClientApprovalStatus     ?? '',
    submittedToClientOn: c.SubmittedToClientOn ? c.SubmittedToClientOn.split('T')[0] : '',
    clientApprovalNotes:      c.ClientApprovalNotes      ?? '',
  });

  if (c.ConfidenceScore) {
    this.form.get('confidenceScore.value')?.setValue(c.ConfidenceScore.toLowerCase());
  }
}

  private patchMeta(c: any): void {
    if (c.CreatedDate) this.createdDate = new Date(c.CreatedDate);
    if (c.UpdatedDate) this.updatedDate = new Date(c.UpdatedDate);

    // c.ConceptId is the anchor and should already match this.conceptId —
    // c.CurrentConceptId is the version/display id, shown but never sent
    // back to the server as concept_id.
    this.displayConceptId = c.CurrentConceptId ?? this.conceptId;

    this.developmentCompleted         = c.DevelopmentCompleted         ? 1 : 0;
    this.clientApprovalCompleted      = c.ClientApprovalCompleted      ? 1 : 0;
    this.supportingDocumentsCompleted = c.SupportingDocumentsCompleted ? 1 : 0;
    this.isDraftConcept = !!c.isDraft || c.RecordType === 'DRAFT';

  }

  private patchAttachments(files: any[]): void {
    this.attachments = { specs: [], table: [], other: [], approval: [] };

    files
      // Supporting Documents share this same active_files array (tagged
      // AttachmentType: "supporting_docs") but belong in their own
      // section — see patchSupportingDocs() below, not here.
      .filter(f => (f.AttachmentType ?? '').toLowerCase() !== 'supporting_docs')
      .forEach(f => {
        const rawCat = (f.AttachmentType ?? '').toLowerCase() as AttachCategory;
        const cat: AttachCategory = ['specs', 'table', 'other', 'approval'].includes(rawCat) ? rawCat : 'other';

        this.attachments[cat] = [
          ...this.attachments[cat],
          {
            id:          f.AttachmentId ? `att_${f.AttachmentId}` : this.generateAttachId(),
            name:        f.FileName,
            size:        f.FileSize ?? 0,
            progress:    100,
            file:        new File([], f.FileName),
            // GET /api/download-attachment/{attachment_id} — streams the file
            // back with Content-Disposition: inline, so the blob just gets
            // handed to the in-app Word/Excel/PDF viewer (see viewAttachment).
            downloadUrl: f.AttachmentId
              ? `api/download-attachment/${f.AttachmentId}`
              : undefined,
            attachmentId: f.AttachmentId ?? undefined
          }
        ];
      });
  }

  /** Restores the Supporting Documents cards from the same active_files
   *  array patchAttachments() reads — the two sections share one backend
   *  table, distinguished only by AttachmentType. supportingDocs is a
   *  fixed 3-slot layout, so saved docs fill slots in order and any
   *  remaining slots stay blank/ready for upload. */
  private patchSupportingDocs(files: any[]): void {
  const blankDoc = (): SupportingDoc => ({
    name: '', sourceurl: '', pdfLocation: '', uploadProgress: 0, file: null
  });

  const savedDocs = files
    .filter(f => (f.AttachmentType ?? '').toLowerCase() === 'supporting_docs')
    .map(f => {
      // A doc is URL-only when sourceurl is filled but FileSize is 0 (or
      // the backend stored no real bytes — e.g. the user only pasted a link).
      const hasRealFile = f.FileSize > 0;

      return {
        name:           f.DocName ?? f.FileName ?? '',
        sourceurl:      f.sourceurl ?? '',
        pdfLocation:    '',
        uploadProgress: hasRealFile ? 100 : 0,
        // Keep file null for URL-only docs so the UI correctly shows
        // the link state instead of a false "Uploaded" success banner.
        file:           hasRealFile
                          ? new File([], f.FileName)   // placeholder for viewer
                          : null,
        downloadUrl:    hasRealFile && f.AttachmentId
                          ? `api/download-attachment/${f.AttachmentId}`
                          : undefined,
        restored:       true,
        // Remembered so an unmodified resubmit can still tell the backend
        // this slot's file is intact — see resolveDocFileMeta() in
        // onDocSubmit(). Without this, a slot that already has a real
        // file looks file-less the moment it's saved again without the
        // user picking a new file.
        originalFileName: hasRealFile ? f.FileName : undefined,
        originalFileSize: hasRealFile ? f.FileSize : undefined,
        // Needed by removeSupportingDoc() to call the delete API — a
        // restored slot always has a real backend record, even URL-only
        // ones (they're still a row in active_files).
        attachmentId: f.AttachmentId ?? undefined
      } as SupportingDoc;
    });

  this.supportingDocs = savedDocs.length > 0
    ? [...savedDocs]
    // ? [...savedDocs, blankDoc()]
    : [blankDoc(), blankDoc(), blankDoc()];
}

  // ── Development Notes (from API) ──────────────────────────────────────
  /** TODO: confirm these field names against your actual development_notes
   *  record shape — the fallbacks below just guard against a couple of
   *  likely naming conventions (e.g. "Createdby" elsewhere in this payload
   *  is a numeric user id, not a name, so we fall back to "User #<id>"
   *  if no display name is supplied). */
  private patchDevNotes(notes: any[]): void {
  const avatarPalette = [
    '#6366f1',
    '#8b5cf6',
    '#0ea5e9',
    '#10b981',
    '#f59e0b',
    '#ef4444'
  ];

  const userColorMap = new Map<string, string>();

  const getAvatarColor = (author: string): string => {
    if (!userColorMap.has(author)) {
      const colorIndex = userColorMap.size % avatarPalette.length;
      userColorMap.set(author, avatarPalette[colorIndex]);
    }
    return userColorMap.get(author)!;
  };

  this.devNotes = (notes ?? []).map((n: any, i: number) => {
    const author =
      n.AuthorName ??
      n.CreatedByName ??
      n.author ??
      (n.Createdby ? `User #${n.Createdby}` : 'User');

    const text = n.NoteText ?? n.Note ?? n.text ?? '';
    const date = n.CreatedDate ?? n.createdDate ?? n.time;

    return {
      id: n.NoteId ? `note_${n.NoteId}` : `note_${i}_${Date.now()}`,
      author,
      initials: author.charAt(0).toUpperCase(),
      avatarBg: getAvatarColor(author),
      time: date ?? '',
      text,
      RoleName: n.RoleName ?? n.Role ?? '',
      persisted: true
    };
  });

  this.scrollNotesToBottom();
}

  // ── Client Approval (from API) ────────────────────────────────────────
  /** TODO: confirm these field names against your actual client_approvals
   *  record shape — mapped here to mirror the PascalCase convention used
   *  elsewhere in this payload (ConceptName, DevelopmentStatus, etc.).
   *  If a concept has no approval submissions yet, client_approvals will
   *  be empty and these fields are simply left blank. */
  private patchClientApproval(approvals: any[]): void {
    if (!approvals || approvals.length === 0) return;

    const latest = [...approvals].sort((a, b) =>
      new Date(b.CreatedDate ?? b.SubmittedDate ?? 0).getTime() -
      new Date(a.CreatedDate ?? a.SubmittedDate ?? 0).getTime()
    )[0];

    this.form.patchValue({
      clientConceptName:        latest.ClientConceptName        ?? '',
      clientConceptDescription: latest.ClientConceptDescription ?? '',
      clientApprovalStatus:     latest.ClientApprovalStatus     ?? '',
      submittedToClientOn: latest.SubmittedToClientOn
        ? latest.SubmittedToClientOn.split('T')[0]
        : '',
      clientApprovalNotes:      latest.ClientApprovalNotes      ?? ''
    });
  }

  // ── Master data (dropdown sources) ────────────────────────────────────
  private loadMasterData(): void {
    this.masterDataLoading = true;

    this.service.getmasterdata().subscribe({
      next: (res) => {
        const data = res?.data ?? {};
        this.developmentStatusOptions     = data.development_status ?? [];
        this.priorityOptions               = data.priority_status ?? [];
        this.clientOptions                 = data.clients ?? [];
        this.masterConceptOptions          = data.master_concepts ?? [];
        this.reviewTypeOptions             = data.review_types ?? [];
        this.claimTypeOptions              = data.claim_types ?? [];
        this.ideationRequestorOptions      = data.ideation_requestors ?? [];
        this.dataScienceProgrammerOptions  = data.datascience_programmers ?? [];
        this.clientApprovalstatusOptions    = data.ClientApproval_status ?? [];
        this.masterDataLoading = false;

        // Master data (and therefore ideationRequestorOptions) loads
        // asynchronously and can resolve after resetToNewConcept() already
        // ran on first page load — try the auto-fill again now that the
        // options list actually has entries to match against.
        this.prefillIdeationRequestor();

        // Same race: refreshAllowedStatuses() may have run before
        // developmentStatusOptions was populated, in which case its
        // filter against an empty array produced an empty dropdown.
        // Re-run it now against whatever status is currently on the form.
        const currentStatus = this.lastKnownDevStatus || 'New';

        if (this.isReadOnly || !Number(sessionStorage.getItem('userId'))) {
          // Read-only roles never populate this.allowedStatuses (they skip
          // the getAllowedStatuses call entirely) — rebuild directly from
          // developmentStatusOptions, which just became available.
          this.allowedStatusOptions = this.developmentStatusOptions.filter(
            d => d.value === currentStatus
          );
        } else if (this.allowedStatuses.length) {
          this.applyAllowedStatusFilter(currentStatus);
        }
      },
      error: (err) => {
        console.error('Failed to load master data:', err);
        this.toastr.error('Failed to load dropdown options', 'Error');
        this.masterDataLoading = false;
      }
    });
  }

  // ── Form ──────────────────────────────────────────────────────────────
  private buildForm(): void {
    this.form = this.fb.group({
      conceptName:           ['', Validators.required],
      clientName:            ['', Validators.required],
      masterConceptName:     ['', Validators.required],
      reviewType:            ['', Validators.required],
      claimType:             ['', Validators.required],
      developmentStatus:     [''],
      priority:              [''],
      haloNumber:            [''],
      Internalconceptdescription:           [''],
      estimatedVolume:       [null, Validators.required],
      estimatedDollars:      ['', Validators.required],
      confidenceScore: this.fb.group({ value: ['medium'] }),
      ideationRequestor:     [''],
      dataScienceProgrammer: [''],
      previousReportId:      [''],
      qaSchedule:          ['', [ConceptCreateComponent.validDateRange, ConceptCreateComponent.notPastDate]],
      productionSchedule:  ['', [ConceptCreateComponent.validDateRange, ConceptCreateComponent.notPastDate]],


      // Client Approval
      clientConceptName:        ['', Validators.required],
      clientConceptDescription: ['', Validators.required],
      clientApprovalStatus:     ['', Validators.required],
      submittedToClientOn: ['', [Validators.required, ConceptCreateComponent.validDateRange, ConceptCreateComponent.notPastDate]],
      clientApprovalNotes:      ['', Validators.required]
    });
  }

  // ── Tabs ──────────────────────────────────────────────────────────────
  setActiveTab(key: string): void {
    this.activeTab = key;

    // Whenever the user lands on Client Approval, make sure the
    // client-facing "Concept Name" field has something in it. If it's
    // still blank (brand-new concept, or an existing one that never had
    // a client name set), fall back to the Concept Development name so
    // the field never appears empty.
    if (key === 'development') {
      // this.loadUserFiles();
    }
    if (key === 'approval') {
      this.ensureClientConceptName();
    }
    if (key === 'documents') {
      // this.loadUserFiles();
    }
  }

  /** Fills clientConceptName from the main conceptName whenever the
   *  client-facing field is empty. Called when the Approval tab opens
   *  and again whenever the user clears the field on blur. */
  private ensureClientConceptName(): void {
    const clientName = this.form.get('clientConceptName')?.value?.trim();
    if (!clientName) {
      const mainName = this.form.get('conceptName')?.value?.trim() ?? '';
      this.form.get('clientConceptName')?.setValue(mainName, { emitEvent: false });
    }
  }

  /** If the client clears the Concept Name field entirely, revert it to
   *  the previous/original concept name on blur instead of leaving it
   *  blank, while still letting them freely edit it in between. */
  onClientConceptNameBlur(): void {
    this.ensureClientConceptName();
  }

  onTabChange(key: string): void {
  // Draft concepts only have the Concept Development tab — clicking
  // Client Approval or Supporting Document shouldn't switch tabs, it
  // should explain why, via a dismissible banner instead of leaving the
  // user to guess from a disabled-looking button.
  if (this.isDraftConcept && key !== 'development') {
    this.flashDraftLockBanner();
    return;
  }

  this.showDraftLockBanner = false;
  this.activeTab = key;
  if (key === 'approval') {
    // Pre-fill clientConceptName from conceptName if blank,
    // so the field is never empty when the tab loads.
    this.ensureClientConceptName();
    this.cdr.detectChanges();
  }
}

  /** Shows the draft-lock banner and auto-dismisses it after a few
   *  seconds. Restarts the timer on repeated clicks so it doesn't
   *  disappear mid-read if the user clicks more than once. */
  private flashDraftLockBanner(): void {
    this.showDraftLockBanner = true;
    if (this.draftLockBannerTimer) {
      clearTimeout(this.draftLockBannerTimer);
    }
    this.draftLockBannerTimer = setTimeout(() => {
      this.showDraftLockBanner = false;
      this.draftLockBannerTimer = null;
    }, 6000);
  }

  dismissDraftLockBanner(): void {
    this.showDraftLockBanner = false;
    if (this.draftLockBannerTimer) {
      clearTimeout(this.draftLockBannerTimer);
      this.draftLockBannerTimer = null;
    }
  }

  // ── Confidence Score ──────────────────────────────────────────────────
  setConfidenceScore(level: 'low' | 'medium' | 'high'): void {
    this.form.get('confidenceScore.value')?.setValue(level);
  }

  // ── Save / Submit ─────────────────────────────────────────────────────
  onSave(): void {
    if (this.form.valid) {
      console.log('Saved:', this.form.value);
      this.updatedDate = new Date();
    } else {
      this.form.markAllAsTouched();
    }
  }

  async onSubmit(): Promise<void> {
    if (!this.canEdit) {
    this.toastr.error('You do not have permission to submit concepts.', 'Access Denied');
    return;
  }
    // Safety net behind the [disabled] binding on the button itself —
    // blocks the call even if it's triggered some other way (e.g. Enter
    // key) while a file's progress bar hasn't reached 100% yet.
    if (this.isAttachmentUploading) {
      this.toastr.error('Please wait for all files to finish uploading.', 'Upload in progress');
      return;
    }
    // Client Name / Master Concept Name / Review Type / Claim Type are
    // only required at creation time — once the concept exists they're
    // hidden (see template) and updates are identified by concept_id
    // alone, so they're skipped from required-field validation here too.
    // Everything else that's required (Concept Name, Estimated Volume,
    // Estimated Dollars) stays editable and mandatory for the entire
    // life of the concept, so clearing one of those on an update must
    // still block submission instead of silently saving it blank.
    const requiredFields: { control: string; label: string }[] = [
      { control: 'conceptName',       label: 'Concept Name' },
      { control: 'estimatedVolume',   label: 'Estimated Volume' },
      { control: 'estimatedDollars',  label: 'Estimated Dollars' },
      ...(!this.conceptId
        ? [
            { control: 'clientName',        label: 'Client Name' },
            { control: 'masterConceptName', label: 'Master Concept Name' },
            { control: 'reviewType',        label: 'Review Type' },
            { control: 'claimType',         label: 'Claim Type' },
          ]
        : []),
    ];

    const missing = requiredFields.filter(f => {
      const value = this.form.get(f.control)?.value;
      return value === null || value === undefined || String(value).trim() === '';
    });

    const dateFields = ['qaSchedule', 'productionSchedule', 'submittedToClientOn'];
    const badDate = dateFields.find(f =>
      this.form.get(f)?.hasError('invalidDateRange') || this.form.get(f)?.hasError('pastDate')
    );
    if (badDate) {
      const isPast = this.form.get(badDate)?.hasError('pastDate');
      this.toastr.error(
        isPast
          ? 'QA Schedule and Production Schedule cannot be set in the past.'
          : 'Please enter a valid date (year must be between 1900 and 2100).',
        'Invalid Date'
      );
      this.form.get(badDate)?.markAsTouched();
      return;
    }

    if (missing.length > 0) {
      // Mark touched so the template's *ngIf error messages light up too
      missing.forEach(f => this.form.get(f.control)?.markAsTouched());
      this.toastr.error(
        `Please fill in: ${missing.map(f => f.label).join(', ')}`,
        'Required fields missing'
      );
      return;
    }

    const hasSpecsFile = this.attachments.specs.length > 0;

    if (!hasSpecsFile) {
      this.toastr.error('Please attach a file in the SPECS section', 'Error');
      return;
    }
    if (this.conceptId) {
      const changedFields = this.getChangedWatchedFields();
      const attachmentsChanged = this.getAttachmentsChanged();
      // devNotes can no longer contain an unsaved entry — notes only land
      // in there after a successful save (see submitConcept()). The only
      // place a not-yet-saved note can be is the input itself.
      const hasNewNote    = this.newNoteText.trim().length > 0;

      if ((changedFields.length > 0 || attachmentsChanged) && !hasNewNote) {
        this.noteInputInvalid = true;
        this.toastr.error(
          'You have changed tracked fields. Please add a Development Note explaining the changes before submitting.',
          'Development Note Required'
        );
        // Scroll note input into view so the user knows exactly what to fill
        document.querySelector<HTMLElement>('.note-input')?.focus();
        return;
      }
    }

    this.noteInputInvalid = false;

    await this.submitConcept(false);
  }

  /** Save as Draft — same upload pipeline as onSubmit, but skips the
   *  mandatory-field / SPECS-file checks since a draft is allowed to be
   *  incomplete. Sends isDraft: 1 in the metadata so the backend can
   *  distinguish a draft save from a final submission. */
  async onSaveAsDraft(): Promise<void> {
    if (!this.canEdit) {
    this.toastr.error('You do not have permission to save drafts.', 'Access Denied');
    return;
  }
    if (this.isAttachmentUploading) {
      this.toastr.error('Please wait for all files to finish uploading.', 'Upload in progress');
      return;
    }
    const conceptName = this.form.get('conceptName')?.value?.trim();
    if (!conceptName) {
      this.form.get('conceptName')?.markAsTouched();
      this.toastr.error('Concept Name is required even to save a draft', 'Error');
      return;
    }

    // Drafts skip most required-field checks, but a past-dated schedule
    // is a data-integrity issue regardless of draft status — block it
    // here too, since onSubmit()'s equivalent check never runs for a
    // draft save.
    const draftDateFields = ['qaSchedule', 'productionSchedule'];
    const badDraftDate = draftDateFields.find(f => this.form.get(f)?.hasError('pastDate'));
    if (badDraftDate) {
      this.toastr.error('QA Schedule and Production Schedule cannot be set in the past.', 'Invalid Date');
      this.form.get(badDraftDate)?.markAsTouched();
      return;
    }

    await this.submitConcept(true);
  }

  /** Shared upload pipeline used by both onSubmit and onSaveAsDraft.
   *  @param isDraft when true, sends isDraft: 1 in the metadata payload
   *  and skips upload entirely if there are no files at all (drafts may
   *  have nothing attached yet). */
  private async submitConcept(isDraft: boolean): Promise<void> {
    this.loading = true;
    // Captured up front — captureNewConceptId() sets this.conceptId /
    // this.isEditMode as soon as the create call returns, so checking
    // either of those *after* the submit completes can no longer tell us
    // whether this submit started out as a brand-new concept.
    const wasCreatingNew = !this.conceptId;

    // A brand-new concept has no development status chosen yet, so it
    // shows/behaves as "New" (see developmentStatusLabel's fallback).
    // The first real Submit (not a draft save) is what moves it out of
    // intake, so auto-advance the status here instead of requiring the
    // user to pick "Programming Queue" manually. Draft saves and later
    // updates leave whatever status is already on the concept alone.
    // Only computed here — the form control itself isn't updated until
    // the request actually succeeds, below.
    const currentDevStatus = this.form.get('developmentStatus')?.value || 'New';
    const autoAdvanceStatus = wasCreatingNew && !isDraft && currentDevStatus === 'New';
    const effectiveDevStatus = autoAdvanceStatus ? 'Programming Queue' : this.form.get('developmentStatus')?.value;

    try {
      const user_id = Number(sessionStorage.getItem('userId'));
      const clientId   = this.form.get('clientName')?.value;
      const masterId   = this.form.get('masterConceptName')?.value;
      const reviewType = this.form.get('reviewType')?.value;
      const claimType  = this.form.get('claimType')?.value;

      const clientName        = this.clientOptions.find(c => c.client_id === clientId)?.client_id ?? '';
      const masterConceptName = this.masterConceptOptions.find(m => m.master_id === masterId)?.master_id ?? '';

      // The note input is never optimistically added to devNotes anymore —
      // it only gets saved (and shown in the list) right here, on Update.
      // So there's exactly one possible pending note: whatever's currently
      // typed. Already-persisted notes are never resent, since that would
      // make the backend insert duplicate rows for them on every update.
      const pendingNote = this.newNoteText.trim();
      const developmentNotes = pendingNote ? [pendingNote] : [];

      const metadata: any = {
        isDraft: isDraft ? 1 : 0,
        // Identifies which concept to update. Empty/omitted on the very
        // first submit (no concept exists yet) — the backend treats that
        // as a create. Every submit after that is an update against this id.
        concept_id:                 this.conceptId || undefined,
        conceptName:                this.form.get('conceptName')?.value,
        InternalConceptDescription: this.form.get('Internalconceptdescription')?.value,
        developmentStatus:          effectiveDevStatus,
        priority:                   this.form.get('priority')?.value,
        haloNumber:                 this.form.get('haloNumber')?.value,
        developmentNotes,
        estimatedVolume:            this.form.get('estimatedVolume')?.value,
        estimatedDollars:           this.form.get('estimatedDollars')?.value,
        confidenceScore:            this.form.get('confidenceScore.value')?.value,
        previousReportId:           this.form.get('previousReportId')?.value,
        qaSchedule:                 this.form.get('qaSchedule')?.value,
        productionSchedule:         this.form.get('productionSchedule')?.value,
        ideationRequestor:          this.form.get('ideationRequestor')?.value,
        dataScienceProgrammer:      this.form.get('dataScienceProgrammer')?.value,
        // A real (non-draft) submit IS the act of completing the
        // Development tab, so it must be sent as 1 in this very request —
        // not read off `this.developmentCompleted`, which is still 0 at
        // this point on the very first ("Create Concept") submit and only
        // gets flipped to 1 further down *after* this request is built.
        DevelopmentCompleted:         isDraft ? this.developmentCompleted : 1,
        ClientApprovalCompleted:      this.clientApprovalCompleted,
        SupportingDocumentsCompleted: this.supportingDocumentsCompleted,
      };

      // Client Name, Master Concept Name, Review Type, and Claim Type are
      // locked (view-only, see lockCoreFields) once the concept exists —
      // only send them on the very first create. On every later update
      // the backend already has them tied to concept_id, so they're left
      // out of the payload entirely instead of being resent unchanged.
      if (!this.conceptId) {
        metadata.clientName        = clientName;
        metadata.masterConceptName = masterConceptName;
        metadata.reviewType        = reviewType;
        metadata.claimType         = claimType;
      }
      const metadataJson = JSON.stringify(metadata);
      const categories: AttachCategory[] = ['specs', 'table', 'other'];

      // Restored attachments are zero-byte placeholders (progress 100,
      // size 0) — they count for display purposes, but there's nothing
      // new in them to upload. Only entries with real bytes belong here;
      // everything else falls through to the metadata-only branch below,
      // otherwise a text-only update (no new files touched) would enter
      // the upload loop, skip every placeholder via `continue`, and never
      // actually call the API at all.
      const filesToUpload: { cat: AttachCategory; entry: AttachFile }[] = [];
      for (const cat of categories) {
        for (const entry of this.attachments[cat]) {
          if (entry.file.size === 0 && entry.progress === 100) continue;
          filesToUpload.push({ cat, entry });
        }
      }

      // Single combined request: metadata + every new attachment from all
      // three categories (specs/table/other) go out together in ONE
      // FormData/API call, instead of one call per file (or per file per
      // chunk) like before. Files are told apart on the backend side by
      // the parallel 'categories' array, matched by position to 'files'.
      const formData = new FormData();
      formData.append('user_id',    user_id.toString());
      formData.append('metadata',   metadataJson);
      formData.append('concept_id', this.conceptId || '');

      filesToUpload.forEach(({ cat, entry }) => {
        formData.append('files',      entry.file, entry.file.name);
        formData.append('categories', cat);
        formData.append('file_names', entry.file.name);
        formData.append('file_sizes', entry.file.size.toString());
      });

      const res: any = await this.service.createconcept(formData).toPromise();
      if (res?.status === 'error' || res?.detail) {
        this.toastr.error(res?.detail || res?.message || 'Something went wrong', 'Error');
        return;
      }
      this.captureNewConceptId(res);
      if (autoAdvanceStatus) {
        this.form.get('developmentStatus')?.setValue('Programming Queue', { emitEvent: false });
        this.refreshAllowedStatuses('Programming Queue');
      }
      // NEW — surface the version bump to the user
      if (res?.version_updated && res?.current_concept_id) {
        this.toastr.info(
          `New version created: ${res.current_concept_id}`,
          'Version Updated'
        );
      }

      // Mark every newly uploaded attachment complete now that the single
      // request has succeeded (no per-chunk progress to track anymore).
      filesToUpload.forEach(({ entry }) => { entry.progress = 100; });

      if (isDraft) {
        this.toastr.success('Draft saved successfully!', 'Success');
      } else {
        this.toastr.success(
          this.isEditMode ? 'Concept updated successfully!' : 'Concept submitted successfully!',
          'Success'
        );
      }
      if (!isDraft) {
        this.developmentCompleted = 1;
        // this.isDraftConcept = false;
      }

      // The pending note (if any), plus every note already in devNotes,
      // just went out inside `metadata` above and is now saved on the
      // backend. Mark everything persisted so the next submit only sends
      // genuinely new notes — otherwise this same list gets re-inserted
      // as duplicates on the next Update.
      this.devNotes = this.devNotes.map(n => ({ ...n, persisted: true }));
      if (pendingNote) {
        this.devNotes = [...this.devNotes, {
          id: `n${Date.now()}`, author: this.currentUserName, initials: this.currentUserInitial,
          avatarBg: '#6366f1', time: new Date().toISOString(), text: pendingNote, RoleName: '', persisted: true
        }];
        this.newNoteText = '';
        this.scrollNotesToBottom();
      }

      // Refresh the left panel so the submitted/updated concept shows
      // up there immediately, without needing a full page reload.
      this.loadLatestUpdates();

      // Only when this submit (a) was a genuine final submit, not a draft
      // save, and (b) started out with no conceptId at all — i.e. this
      // really was "create a new concept", not editing/finalizing an
      // existing draft. Editing an existing record should keep showing
      // that record, not blank out from under the user.
      if (!isDraft && wasCreatingNew) {
        this.resetToNewConcept();
      } else if (this.conceptId) {
        // Soft-reload so every field reflects exactly what the server
        // just persisted — no full page reload, no tab switch.
        this.refreshConceptData(this.conceptId);
      }
    } catch (err: any) {
      const errorMsg =
        err?.error?.detail  ||
        err?.error?.message ||
        err?.message        ||
        'Upload failed. Please try again.';
      this.toastr.error(errorMsg, 'Error');
    } finally {
      this.loading = false;
    }
  }

  /** When creating a brand-new concept, the very first save call is what
   *  assigns its ID on the backend. Capture it here so the *next* save in
   *  the same session (e.g. switching tabs and hitting Submit again)
   *  updates that same concept instead of creating a duplicate.
   *  NOTE: adjust the field names below to match your actual API response shape. */
  private captureNewConceptId(res: any): void {
    // res.concept_id is the stable anchor and should never change once set
    // — only capture it the first time (on genuine create). res.current_concept_id
    // is the version/display id and DOES change on every update, so it's
    // always safe (and necessary) to refresh displayConceptId here.
    const anchorId = res?.concept_id ?? res?.ConceptId ?? res?.data?.ConceptId ?? res?.concept?.ConceptId;
    const currentId = res?.current_concept_id ?? res?.CurrentConceptId ?? anchorId;

    if (!this.conceptId && anchorId) {
      this.conceptId  = anchorId;
      this.isEditMode = true;
      this.lockCoreFields();
    }
    if (currentId) {
      this.displayConceptId = currentId;
    }
  }

  /** Client Name, Master Concept Name, Review Type, and Claim Type are
   *  set once at creation and shouldn't change afterward — lock them
   *  (view-only) as soon as the concept exists, whether that's a
   *  just-created concept in this session or one restored from a saved
   *  record. submitConcept() separately checks isEditMode/conceptId to
   *  stop resending these in the update payload — see there. */
  private lockCoreFields(): void {
    ['clientName', 'masterConceptName', 'reviewType', 'claimType'].forEach(name => {
      this.form.get(name)?.disable({ emitEvent: false });
    });
  }

  // ── Add new concept ───────────────────────────────────────────────────
  onAddNewConcept(): void {
    // Navigating to the same '/concept-create' URL we're already on (e.g.
    // mid-draft — submitConcept() never pushes the new conceptId into the
    // URL) is a no-op for the router: no NavigationEnd, no paramMap
    // emission, so the routeSub in ngOnInit() never calls
    // resetToNewConcept() and the button appears broken. Reset directly
    // instead of depending on that route change firing.
    this.resetToNewConcept();

  if (this.router.url !== '/concept-create') {
    this.router.navigate(['/concept-create']);
  }
}

  private resetToNewConcept(): void {
  this.isEditMode  = false;
  this.isDraftConcept = false;
  this.buildForm();
  this.conceptId   = '';
  this.displayConceptId = '';
  this.createdDate = new Date();
  this.updatedDate = new Date();
  this.uploadedFiles = [];
  this.owners        = [];
  this.devNotes      = [];
  this.newNoteText   = '';
  this.attachments   = { specs: [], table: [], other: [], approval: [] };
  this.originalAttachmentIds = { specs: new Set(), table: new Set(), other: new Set(), approval: new Set() };
  this.activeTab     = 'development';
  this.developmentCompleted         = 0;
  this.clientApprovalCompleted      = 0;
  this.supportingDocumentsCompleted = 0;
  this.supportingDocs = [
    { name: '', sourceurl: '', pdfLocation: '', uploadProgress: 0, file: null },
    { name: '', sourceurl: '', pdfLocation: '', uploadProgress: 0, file: null },
    { name: '', sourceurl: '', pdfLocation: '', uploadProgress: 0, file: null }
  ];
  this.applyRoleRestrictions();
  this.refreshAllowedStatuses('New');
  // loadMasterData() only runs once per page load (see ngOnInit), so on a
  // create -> save -> create-again cycle the options list is already
  // populated by the time we land back here — try the auto-fill
  // immediately. If the options aren't loaded yet (very first load of a
  // brand-new concept), loadMasterData()'s callback retries this once
  // they arrive.
  this.prefillIdeationRequestor();
}

  /** Auto-fills "Ideation Requestor" with the logged-in user's own entry
   *  when creating a brand-new concept — but ONLY for roles who can
   *  actually be an Ideation Requestor: Ideation Requestor, QA, and
   *  Manager (the same set as canFullEdit). Every other role (e.g. Data
   *  Science Programmer) leaves the field on "Select" and picks someone
   *  from the dropdown manually. Skipped entirely in edit mode, where the
   *  field is patched from the saved concept's own data instead — see
   *  patchForm(). */
  private prefillIdeationRequestor(): void {
    if (this.isEditMode) return;
    if (!this.canFullEdit) return;

    const control = this.form.get('ideationRequestor');
    if (!control || control.value) return; // already has a value — don't clobber it

    const userId = Number(sessionStorage.getItem('userId'));
    if (!userId) return;

    const match = this.ideationRequestorOptions.find(u => u.id === userId);
    if (match) {
      control.setValue(match.id, { emitEvent: false });
    }
  }

  // ── Ownership ─────────────────────────────────────────────────────────
  addOwnership(): void {
    this.showOwnerDropdown = !this.showOwnerDropdown;
    this.ownerSearch = '';
  }

  selectAndAddOwner(c: OwnerCandidate): void {
    this.owners = [...this.owners, {
      id: c.id, name: c.name, department: c.department,
      initials: c.initials, avatarColor: c.avatarColor
    }];
    this.showOwnerDropdown = false;
    this.ownerSearch = '';
  }

  cancelOwnerDropdown(): void {
    this.showOwnerDropdown = false;
    this.ownerSearch = '';
  }

  removeOwner(id: string): void {
    this.owners = this.owners.filter(o => o.id !== id);
  }

  // ── Dev Notes ─────────────────────────────────────────────────────────
  // There's no "add to list" action here anymore — the typed text in
  // newNoteText just sits in the input until Update is clicked. That's
  // picked up as `pendingNote` in submitConcept() and only added to
  // devNotes (so it becomes visible) once the save actually succeeds.

  private scrollNotesToBottom(): void {
    setTimeout(() => {
      const el = this.notesListRef?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  // ── Attachments ───────────────────────────────────────────────────────
  triggerAttachUpload(cat: AttachCategory): void {
    if (this.blockIfCannotManage(cat)) return;
    const map: Record<AttachCategory, ElementRef<HTMLInputElement>> = {
      specs: this.specsInputRef,
      table: this.tableInputRef,
      other: this.otherInputRef,
      approval: this.approvalInputRef
    };
    map[cat]?.nativeElement.click();
  }

  onAttachSelected(event: Event, cat: AttachCategory): void {
    if (this.blockIfCannotManage(cat)) return;
    const input = event.target as HTMLInputElement;
    if (!input.files) return;
    Array.from(input.files).forEach(file => {
      const entry: AttachFile = { id: this.generateAttachId(), name: file.name, size: file.size, progress: 0, file };
      this.attachments[cat] = [...this.attachments[cat], entry];
      this.simulateUpload(cat, entry.id);
    });
    input.value = '';
  }

  onAttachDragOver(event: DragEvent): void {
    event.preventDefault(); event.stopPropagation();
  }

  onAttachDrop(event: DragEvent, cat: AttachCategory): void {
    event.preventDefault(); event.stopPropagation();
    if (this.blockIfCannotManage(cat)) return;
    const files = event.dataTransfer?.files;
    if (!files) return;
    Array.from(files).forEach(file => {
      const entry: AttachFile = { id: this.generateAttachId(), name: file.name, size: file.size, progress: 0, file };
      this.attachments[cat] = [...this.attachments[cat], entry];
      this.simulateUpload(cat, entry.id);
    });
  }

  /** A file just picked this session (never submitted) has no backend
   *  record yet — drop it locally, nothing to call. A file restored from
   *  a saved concept has a real AttachmentId, so it has to be deleted on
   *  the backend first; the card is only removed from the UI once that
   *  call succeeds, so a failed delete doesn't silently desync the UI
   *  from what's actually still stored server-side. */
  async removeAttachment(cat: AttachCategory, f: AttachFile): Promise<void> {
    if (this.blockIfCannotManage(cat)) return;
    if (!f.attachmentId) {
      this.attachments[cat] = this.attachments[cat].filter(x => x !== f);
      return;
    }

    // NEW: SPECS must always have at least one file on an existing
    // concept — block removing the last one instead of letting the
    // delete API fire immediately and leave the concept spec-less.
    if (cat === 'specs' && this.attachments.specs.length <= 1) {
      this.toastr.error(
        'At least one SPECS file is required. Upload a replacement before removing this one.',
        'Cannot Remove'
      );
      return;
    }

    const user_id = Number(sessionStorage.getItem('userId'));
    try {
      const formData = new FormData();
      formData.append('concept_id',    this.conceptId);
      formData.append('attachment_id', f.attachmentId.toString());
      formData.append('category',      cat);
      formData.append('user_id',       user_id.toString());

      await this.service.deleteattachment(formData).toPromise();
      this.attachments[cat] = this.attachments[cat].filter(x => x !== f);
      this.toastr.success('File deleted successfully!', 'Success');
    } catch (err: any) {
      const msg = err?.error?.detail || err?.error?.message || err?.message || 'Failed to delete file';
      this.toastr.error(msg, 'Error');
    }
  }

  private generateAttachId(): string {
    return `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  private simulateUpload(cat: AttachCategory, entryId: string): void {
    let progress = 0;
    const interval = setInterval(() => {
      progress = Math.min(progress + 10, 100);

      // Match by stable id, not object reference — the array items are
      // replaced with new objects on every tick, so comparing against the
      // originally-captured object would only ever match once (tick 1)
      // and then silently stop updating, leaving progress stuck.
      this.attachments[cat] = this.attachments[cat].map(item =>
        item.id === entryId ? { ...item, progress } : item
      );
      this.cdr.detectChanges();

      if (progress >= 100) clearInterval(interval);
    }, 200);
  }

  // ── Supporting-doc upload ─────────────────────────────────────────────
  triggerFileUpload(): void { this.fileInput?.nativeElement.click(); }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files) this.uploadedFiles = [...this.uploadedFiles, ...Array.from(input.files)];
  }

  onDragOver(event: DragEvent): void { event.preventDefault(); event.stopPropagation(); }

  onDrop(event: DragEvent): void {
    event.preventDefault(); event.stopPropagation();
    const files = event.dataTransfer?.files;
    if (files) this.uploadedFiles = [...this.uploadedFiles, ...Array.from(files)];
  }

  removeFile(index: number): void {
    this.uploadedFiles = this.uploadedFiles.filter((_, i) => i !== index);
  }

  formatFileSize(bytes: number): string {
    if (bytes < 1024)    return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  }

  // ── Breadcrumb ────────────────────────────────────────────────────────
  navigateToConcepts(): void { this.router.navigate(['/dashboard']); }

  // Concept IDs are assigned by the backend on creation — no client-side generation.

  // ── Client Approval ───────────────────────────────────────────────────
  async onApprovalSubmit(): Promise<void> {
    if (!this.canSubmitApproval) {
    this.toastr.error('You do not have permission to submit client approvals.', 'Access Denied');
    return;
  }
  if (this.isDraftConcept) {
    this.toastr.error(
      'This concept is still a draft. Please submit the Concept Development tab first before adding a Client Approval.',
      'Concept Not Submitted'
    );
    return;
  }
    // Safety net behind the [disabled] binding on the button itself —
    // blocks the call even if it's triggered some other way (e.g. Enter
    // key) while a file's progress bar hasn't reached 100% yet.
    if (this.isApprovalAttachmentUploading) {
      this.toastr.error('Please wait for all files to finish uploading.', 'Upload in progress');
      return;
    }

    // Every field on this tab is mandatory before submitting.
    const requiredFields: { control: string; label: string }[] = [
      { control: 'clientConceptName',        label: 'Concept Name' },
      { control: 'clientConceptDescription', label: 'Client Concept Description' },
      { control: 'clientApprovalStatus',     label: 'Client Approval Status' },
      { control: 'submittedToClientOn',      label: 'Submitted To Client On' },
      { control: 'estimatedVolume',          label: 'Estimated Volume' },
      { control: 'estimatedDollars',         label: 'Estimated Dollars' },
      { control: 'clientApprovalNotes',      label: 'Client Review & Approval Notes' }
    ];

    const missing = requiredFields.filter(f => {
      const value = this.form.get(f.control)?.value;
      return value === null || value === undefined || String(value).trim() === '';
    });

    if (missing.length > 0) {
      // Mark touched so the template's *ngIf error messages light up too
      missing.forEach(f => this.form.get(f.control)?.markAsTouched());
      this.toastr.error(
        `Please fill in: ${missing.map(f => f.label).join(', ')}`,
        'Required fields missing'
      );
      return;
    }

    const submittedDateControl = this.form.get('submittedToClientOn');
    if (submittedDateControl?.hasError('invalidDateRange') || submittedDateControl?.hasError('pastDate')) {
      const isPast = submittedDateControl.hasError('pastDate');
      this.toastr.error(
        isPast
          ? 'Submitted To Client On cannot be in the past.'
          : 'Please enter a valid date (year must be between 1900 and 2100).',
        'Invalid Date'
      );
      submittedDateControl.markAsTouched();
      return;
    }

    // Attachment is optional on the Client Approval tab — skip the
    // "at least one file" guard that was here previously.

    // Safety net: never submit a blank client-facing concept name —
    // fall back to the main Concept Name if it was somehow left empty.
    this.ensureClientConceptName();

    const approvalData = {
      conceptId:                this.conceptId,
      conceptname: this.form.get('conceptName')?.value,
      clientConceptName:        this.form.get('clientConceptName')?.value,
      clientConceptDescription: this.form.get('clientConceptDescription')?.value,
      clientApprovalStatus:     this.form.get('clientApprovalStatus')?.value,
      submittedToClientOn:      this.form.get('submittedToClientOn')?.value,
      clientApprovalNotes:      this.form.get('clientApprovalNotes')?.value,
      estimatedVolume:          this.form.get('estimatedVolume')?.value,
      estimatedDollars:         this.form.get('estimatedDollars')?.value,
      clientApprovalCompleted:  1
    };
    console.log('Client Approval Data:', approvalData);

    
    await this.submitClientApproval(this.conceptId,approvalData);
  }

  async submitClientApproval(conceptId:string,data: any): Promise<void> {
  this.loading = true;

    try {
      const user_id = Number(sessionStorage.getItem('userId'));
      const formData = new FormData();
      formData.append('data', JSON.stringify(data));
      formData.append('user_id', user_id.toString());
      formData.append('concept_id', conceptId || '');

      // Only newly-picked files have real bytes to upload — restored
      // placeholders (zero-byte, progress 100) are already saved on the
      // backend and are skipped here, same pattern as submitConcept()'s
      // filesToUpload above.
      const filesToUpload = this.attachments.approval.filter(
        f => f.file && f.file.size > 0
      );
      filesToUpload.forEach(entry => {
        formData.append('files',      entry.file, entry.file.name);
        formData.append('categories', 'approval');
        formData.append('file_names', entry.file.name);
        formData.append('file_sizes', entry.file.size.toString());
      });

      // Diagnostic — remove once attachments are confirmed saving.
      console.log('[submitClientApproval] filesToUpload count:', filesToUpload.length,
        filesToUpload.map(f => f.name));

      const response = await this.service.submitclientApproval(formData,conceptId).toPromise();
      filesToUpload.forEach(entry => { entry.progress = 100; });
      this.clientApprovalCompleted = 1;
      this.toastr.success('Approval submitted successfully!', 'Success');

      // Refresh the left panel + soft-reload this concept's data so the
      // page reflects exactly what was just persisted — no full page
      // reload.
      this.loadLatestUpdates();
      this.refreshConceptData(conceptId);
    } catch (error) {
      this.toastr.error('Error submitting approval.', 'Error');
    } finally {
      this.loading = false;
    }
  }
  // ── Supporting Documents ──────────────────────────────────────────────
  onAddSupportingDoc(): void {
    if (this.blockIfCannotManageDocs()) return;
    this.supportingDocs = [
      ...this.supportingDocs,
      { name: '', sourceurl: '', pdfLocation: '', uploadProgress: 0, file: null }
    ];
  }

  /** Same split as removeAttachment() above: a slot added/filled this
   *  session but never submitted has no backend record (no
   *  attachmentId) — just drop it from the array. A restored slot always
   *  has one (every active_files row, even URL-only docs, gets an
   *  AttachmentId — see patchSupportingDocs), so it has to be deleted on
   *  the backend first, and the card only disappears once that succeeds. */
  async removeSupportingDoc(index: number): Promise<void> {
    if (this.blockIfCannotManageDocs()) return;
    const doc = this.supportingDocs[index];

    if (!doc?.attachmentId) {
      this.removeSupportingDocLocally(index);
      return;
    }

    // NEW: once a concept has supporting documents on the backend, at
    // least one must remain — block removing the last saved one instead
    // of letting the delete API fire immediately and leave the concept
    // with zero supporting documents.
    const savedDocsCount = this.supportingDocs.filter(d => d.attachmentId).length;
    if (savedDocsCount <= 1) {
      this.toastr.error(
        'At least one supporting document is required. Add a replacement before removing this one.',
        'Cannot Remove'
      );
      return;
    }

    const user_id = Number(sessionStorage.getItem('userId'));
    try {
      const formData = new FormData();
      formData.append('concept_id',    this.conceptId);
      formData.append('attachment_id', doc.attachmentId.toString());
      formData.append('category',      'supporting_docs');
      formData.append('user_id',       user_id.toString());

      await this.service.deleteattachment(formData).toPromise();
      this.removeSupportingDocLocally(index);
      this.toastr.success('Document deleted successfully!', 'Success');
    } catch (err: any) {
      const msg = err?.error?.detail || err?.error?.message || err?.message || 'Failed to delete document';
      this.toastr.error(msg, 'Error');
    }
  }

  private removeSupportingDocLocally(index: number): void {
    this.supportingDocs = this.supportingDocs.filter((_, i) => i !== index);
    if (this.modalSelectedIndex !== null) {
      if (index === this.modalSelectedIndex) this.modalSelectedIndex = null;
      else if (index < this.modalSelectedIndex) this.modalSelectedIndex--;
    }
  }

  triggerDocFileInput(index: number): void {
    if (this.blockIfCannotManageDocs()) return;
    this.pendingDocIndex = index;
    this.docFileInputRef?.nativeElement.click();
  }

  onGlobalDocFileSelected(event: Event): void {
    if (this.blockIfCannotManageDocs()) return;
    if (this.pendingDocIndex === null) return;
    const input = event.target as HTMLInputElement;
    const file  = input.files?.[0];
    if (!file) return;
    const idx = this.pendingDocIndex;
    this.supportingDocs = this.supportingDocs.map((doc, i) =>
      i === idx
        ? { ...doc, name: file.name, file, uploadProgress: 0, url: '', originalFileName: undefined, originalFileSize: undefined }
        : doc
    );
    this.cdr.detectChanges();
    this.simulateDocUpload(idx);
    input.value = '';
    this.pendingDocIndex = null;
  }

  onDocFileSelected(event: Event, index: number): void {
    if (this.blockIfCannotManageDocs()) return;
    const input = event.target as HTMLInputElement;
    const file  = input.files?.[0];
    if (!file) return;
    const updated  = [...this.supportingDocs];
    updated[index] = { ...updated[index], name: file.name.replace(/\.[^.]+$/, ''), file, uploadProgress: 0, sourceurl: '', originalFileName: undefined, originalFileSize: undefined };
    this.supportingDocs = updated;
    this.simulateDocUpload(index);
    input.value = '';
  }

  onDocDrop(event: DragEvent, index: number): void {
    event.preventDefault(); event.stopPropagation();
    if (this.blockIfCannotManageDocs()) return;
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    const updated  = [...this.supportingDocs];
    updated[index] = { ...updated[index], name: file.name.replace(/\.[^.]+$/, ''), file, uploadProgress: 0, sourceurl: '', originalFileName: undefined, originalFileSize: undefined };
    this.supportingDocs = updated;
    this.simulateDocUpload(index);
  }

  /** Clears this entire Supporting Document card back to blank — file,
   *  Document Name, Source URL, and PDF Location all reset, same as an
   *  empty slot. The card itself (and its position in the list) stays;
   *  use the "Delete" button (removeSupportingDoc()) to remove the slot
   *  entirely.
   *
   *  This is UI-only: it does NOT call the delete API, so if this slot
   *  was restored from a saved concept, the backend record isn't
   *  touched yet. originalFileName/originalFileSize are cleared too —
   *  otherwise resolveDocFileMeta() would fall back to the old file info
   *  on the next submit and silently resurrect a file the user just
   *  cleared from the screen. attachmentId is kept so the "Delete"
   *  button can still remove the underlying backend record if the user
   *  uses it afterward. */
  clearDocFile(event: Event, index: number): void {
    event.stopPropagation();
    if (this.blockIfCannotManageDocs()) return;
    const updated = [...this.supportingDocs];
    updated[index] = {
      ...updated[index],
      name: '',
      sourceurl: '',
      pdfLocation: '',
      file: null,
      uploadProgress: 0,
      downloadUrl: undefined,
      restored: false,
      originalFileName: undefined,
      originalFileSize: undefined
    };
    this.supportingDocs = updated;
  }

  // ── Doc Viewer ────────────────────────────────────────────────────────
  isWordExt(ext: string): boolean  { return ['docx', 'doc'].includes(ext.toLowerCase()); }
  isExcelExt(ext: string): boolean { return ['xlsx', 'xls'].includes(ext.toLowerCase()); }
  isPdfExt(ext: string): boolean   { return ext.toLowerCase() === 'pdf'; }

  /** Fetches a stored file's bytes from /api/download-attachment/{id} and
   *  opens it in the in-app preview (Word/Excel/PDF viewer). Shared by
   *  both the Concept Development "Attachments" cards (viewAttachment)
   *  and Supporting Documents (viewDoc), since both now resolve to the
   *  same backend endpoint, keyed by AttachmentId. */
  private fetchAndViewRemoteFile(name: string, downloadUrl: string): void {
    // this.toastr.info('Loading file…', '', { timeOut: 1500 });

    this.service.getPdfFile(downloadUrl).subscribe({
      next: (blob: Blob) => {
        // new File() does NOT inherit the blob's MIME type unless told to.
        // Without it, the blob: URL built later in renderDocPdf() ends up
        // with no type at all, so the browser can't tell it's a PDF and
        // falls back to showing the raw bytes as plain text instead of
        // rendering it — falling back to the extension when the server
        // didn't set (or HttpClient didn't preserve) a Content-Type.
        const mimeType = blob.type || this.inferMimeType(name);
        const realFile = new File([blob], name, { type: mimeType });
        this.viewDoc({ name, sourceurl: '', pdfLocation: '', uploadProgress: 100, file: realFile });
      },
      error: (err) => {
        console.error('Failed to fetch file:', err);
        this.toastr.error('Could not load file for preview', 'Error');
      }
    });
  }

  private inferMimeType(name: string): string {
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    switch (ext) {
      case 'pdf':  return 'application/pdf';
      case 'doc':  return 'application/msword';
      case 'docx': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      case 'xls':  return 'application/vnd.ms-excel';
      case 'xlsx': return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      default:     return 'application/octet-stream';
    }
  }

  /** View an Attachments-tab file (specs/table/other) using the same
   *  Word/Excel preview popup as Supporting Documents. Newly-selected
   *  files already have real bytes in memory; files restored from a
   *  saved concept are empty placeholders and need to be fetched first. */
  async viewAttachment(f: AttachFile): Promise<void> {
    if (f.progress < 100) {
      this.toastr.error('Wait for the upload to finish before viewing', 'Error');
      return;
    }

    // Already have real bytes (just-selected/uploaded file) — view directly.
    if (f.file && f.file.size > 0) {
      this.viewDoc({ name: f.name, sourceurl: '', pdfLocation: '', uploadProgress: f.progress, file: f.file });
      return;
    }

    // Placeholder from a saved concept — fetch the actual bytes first.
    if (!f.downloadUrl) {
      this.toastr.error('No file available to preview', 'Error');
      return;
    }

    this.fetchAndViewRemoteFile(f.name, f.downloadUrl);
  }

  async viewDoc(doc: SupportingDoc): Promise<void> {
    if (doc.file && doc.uploadProgress < 100) {
      this.toastr.error('Wait for the upload to finish before viewing', 'Error');
      return;
    }

    // Restored from a saved concept — placeholder has no real bytes yet
    // (patchSupportingDocs sets a zero-byte File), fetch them from
    // /api/download-attachment/{id} first, same as viewAttachment.
    if ((!doc.file || doc.file.size === 0) && doc.downloadUrl) {
      this.fetchAndViewRemoteFile(doc.name, doc.downloadUrl);
      return;
    }

    const file = doc.file;
    if (file) {
      const ext = file.name.split('.').pop()?.toLowerCase() ?? '';

      if (this.isWordExt(ext) || this.isExcelExt(ext) || this.isPdfExt(ext)) {
        this.docViewerFileName = file.name;
        this.docViewerFileExt  = ext.toUpperCase();
        this.docWordHtml       = '';
        this.docSheets         = [];
        this.docActiveSheet    = 0;
        this.revokePdfUrl();
        this.docViewerVisible  = true;
        this.docViewerLoading  = true;
        // Force a render now so the backdrop + "Loading preview…" state is
        // visible immediately, before we hand off to native browser APIs
        // below (createObjectURL / Blob.arrayBuffer) whose promise
        // resolution isn't always picked up by zone.js, which is what was
        // causing the popup to look "stuck" until a second click.
        this.cdr.detectChanges();
        try {
          if (this.isPdfExt(ext)) {
            this.renderDocPdf(file);
          } else {
            const arrayBuffer = await file.arrayBuffer();
            if (this.isWordExt(ext)) await this.renderDocWord(arrayBuffer);
            else this.renderDocExcel(arrayBuffer);
          }
        } catch (err: any) {
          this.toastr.error('Could not open file: ' + err.message, 'Error');
          this.docViewerVisible = false;
        } finally {
          this.docViewerLoading = false;
          // Native APIs above (Blob.arrayBuffer, createObjectURL) can
          // resolve outside Angular's zone, so explicitly trigger a render
          // here instead of waiting for the next zone-tracked event.
          this.cdr.detectChanges();
        }
        return;
      }
    }
    if (doc.pdfLocation)     window.open(doc.pdfLocation, '_blank');
    else if (doc.sourceurl)        window.open(doc.sourceurl, '_blank');
    else if (file && file.size > 0) {
      // Generic fallback for file types we don't render inline (images, etc.)
      const objectUrl = URL.createObjectURL(file);
      window.open(objectUrl, '_blank');
    }
    else this.toastr.error('Nothing to preview for this document', 'Error');
  }

  private renderDocPdf(file: File): void {
    this.docPdfObjectUrl = URL.createObjectURL(file);
    this.docPdfUrl = this.sanitizer.bypassSecurityTrustResourceUrl(this.docPdfObjectUrl);
  }

  private revokePdfUrl(): void {
    if (this.docPdfObjectUrl) {
      URL.revokeObjectURL(this.docPdfObjectUrl);
      this.docPdfObjectUrl = null;
    }
    this.docPdfUrl = null;
  }

  private async renderDocWord(buffer: ArrayBuffer): Promise<void> {
    const result     = await mammoth.convertToHtml({ arrayBuffer: buffer });
    this.docWordHtml = this.sanitizer.bypassSecurityTrustHtml(result.value);
  }

  private renderDocExcel(buffer: ArrayBuffer): void {
    const workbook   = XLSX.read(new Uint8Array(buffer), { type: 'array' });
    this.docSheets   = workbook.SheetNames.map(name => {
      const ws       = workbook.Sheets[name];
      const data: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });
      return { sheetName: name, headers: (data[0] as string[]) || [], rows: data.slice(1) };
    });
  }

  closeDocViewer(): void {
    this.docViewerVisible = false;
    this.revokePdfUrl();
  }
  setDocActiveSheet(i: number): void { this.docActiveSheet = i; }

  // ── Downloads ────────────────────────────────────────────────────────
  /** Forces the browser to save `blobOrFile` as `filename` instead of
   *  navigating to / opening it inline. Shared by every per-file Download
   *  button below and by both "Download All" actions. */
  private triggerDownload(blobOrFile: Blob, filename: string): void {
    const objectUrl = URL.createObjectURL(blobOrFile);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename || 'download';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    // Give the browser a moment to pick up the blob: URL before revoking it.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }

  /** Downloads a single Attachments-tab file (specs/table/other). Files
   *  just picked in this session already have real bytes in memory;
   *  files restored from a saved concept are zero-byte placeholders and
   *  need their bytes fetched from /api/download-attachment/{id} first —
   *  same split used by viewAttachment() above. */
  downloadAttachment(f: AttachFile): void {
    if (f.progress < 100) {
      this.toastr.error('Wait for the upload to finish before downloading', 'Error');
      return;
    }
    if (f.file && f.file.size > 0) {
      this.triggerDownload(f.file, f.name);
      return;
    }
    if (!f.downloadUrl) {
      this.toastr.error('No file available to download', 'Error');
      return;
    }
    this.service.getPdfFile(f.downloadUrl).subscribe({
      next: (blob: Blob) => this.triggerDownload(blob, f.name),
      error: (err) => {
        console.error('Failed to download file:', err);
        this.toastr.error('Could not download file', 'Error');
      }
    });
  }

  /** True once at least one file exists in any of the three Attachments
   *  categories — drives [disabled] on the card's "Download All" button. */
  get hasAnyAttachments(): boolean {
    return this.attachments.specs.length > 0 ||
           this.attachments.table.length  > 0 ||
           this.attachments.other.length  > 0;
  }

  /** Same as hasAnyAttachments, scoped to the Client Approval tab's own
   *  attachment category — drives [disabled] on that section's own
   *  "Download All" button without mixing in Development-tab files. */
  get hasAnyApprovalAttachments(): boolean {
    return this.attachments.approval.length > 0;
  }

  /** Downloads every Attachments-tab file across all three categories.
   *  Browsers throttle/block several programmatic downloads fired in the
   *  same tick, so each one is staggered slightly. */
  downloadAllAttachments(): void {
    const all: AttachFile[] = [
      ...this.attachments.specs,
      ...this.attachments.table,
      ...this.attachments.other
    ];
    const ready = all.filter(f => f.progress >= 100 && (f.file?.size || f.downloadUrl));
    if (ready.length === 0) {
      this.toastr.error('No files available to download', 'Error');
      return;
    }
    ready.forEach((f, i) => setTimeout(() => this.downloadAttachment(f), i * 400));
  }

  /** Downloads every file attached in the Client Approval tab's own
   *  Attachments section. Mirrors downloadAllAttachments() above but
   *  scoped to the 'approval' category only. */
  downloadAllApprovalAttachments(): void {
    const ready = this.attachments.approval.filter(
      f => f.progress >= 100 && (f.file?.size || f.downloadUrl)
    );
    if (ready.length === 0) {
      this.toastr.error('No files available to download', 'Error');
      return;
    }
    ready.forEach((f, i) => setTimeout(() => this.downloadAttachment(f), i * 400));
  }

  /** Downloads a single Supporting Documents card's file. Cards that only
   *  hold a source URL or PDF location (no actual uploaded file) have
   *  nothing to force-download, so those just open in a new tab instead. */
  downloadDoc(doc: SupportingDoc): void {
    if (doc.file && doc.uploadProgress < 100) {
      this.toastr.error('Wait for the upload to finish before downloading', 'Error');
      return;
    }
    if (doc.file && doc.file.size > 0) {
      this.triggerDownload(doc.file, doc.name || doc.file.name);
      return;
    }
    if (doc.downloadUrl) {
      this.service.getPdfFile(doc.downloadUrl).subscribe({
        next: (blob: Blob) => this.triggerDownload(blob, doc.name || 'document'),
        error: (err) => {
          console.error('Failed to download file:', err);
          this.toastr.error('Could not download file', 'Error');
        }
      });
      return;
    }
    if (doc.pdfLocation) { window.open(doc.pdfLocation, '_blank'); return; }
    if (doc.sourceurl)   { window.open(doc.sourceurl, '_blank');   return; }
    this.toastr.error('Nothing to download for this document', 'Error');
  }

  /** True once at least one Supporting Document card has something in it
   *  (file, downloadUrl, source URL, or PDF location) — drives
   *  [disabled] on the section's "Download All" button. */
  get hasAnySupportingDocs(): boolean {
    return this.supportingDocs.some(
      d => d.file || d.downloadUrl || d.sourceurl?.trim() || d.pdfLocation?.trim()
    );
  }

  /** Downloads (or opens, for URL/PDF-location-only entries) every
   *  non-empty Supporting Document card. Staggered for the same reason
   *  as downloadAllAttachments() above. */
  downloadAllSupportingDocs(): void {
    const ready = this.supportingDocs.filter(
      d => d.file || d.downloadUrl || d.sourceurl?.trim() || d.pdfLocation?.trim()
    );
    if (ready.length === 0) {
      this.toastr.error('No documents available to download', 'Error');
      return;
    }
    ready.forEach((d, i) => setTimeout(() => this.downloadDoc(d), i * 400));
  }

  private simulateDocUpload(index: number): void {
    let progress = 0;
    const interval = setInterval(() => {
      progress += 5;
      this.supportingDocs[index] = { ...this.supportingDocs[index], uploadProgress: progress };
      this.supportingDocs = [...this.supportingDocs];
      this.cdr.detectChanges();
      if (progress >= 100) clearInterval(interval);
    }, 300);
  }

  // ── Upload Modal ──────────────────────────────────────────────────────
  openUploadModal(): void {
    this.showUploadModal    = true;
    this.modalSelectedIndex = this.supportingDocs.length > 0 ? this.supportingDocs.length - 1 : null;
  }

  closeUploadModal(): void { this.showUploadModal = false; }

  onModalFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file  = input.files?.[0];
    if (!file) return;
    const newDoc: SupportingDoc = { name: file.name.replace(/\.[^.]+$/, ''), sourceurl: '', pdfLocation: '', uploadProgress: 0, file };
    this.supportingDocs     = [...this.supportingDocs, newDoc];
    this.modalSelectedIndex = this.supportingDocs.length - 1;
    this.simulateDocUpload(this.modalSelectedIndex);
    input.value = '';
  }

  onModalDrop(event: DragEvent): void {
    event.preventDefault(); event.stopPropagation();
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    const newDoc: SupportingDoc = { name: file.name.replace(/\.[^.]+$/, ''), sourceurl: '', pdfLocation: '', uploadProgress: 0, file };
    this.supportingDocs     = [...this.supportingDocs, newDoc];
    this.modalSelectedIndex = this.supportingDocs.length - 1;
    this.simulateDocUpload(this.modalSelectedIndex);
  }

  /** Resolves the fileName/fileSize to report to the backend for one
   *  Supporting Document slot's update:
   *  - A freshly-picked file (real bytes, chosen this session) reports its
   *    own name/size — the binary itself goes out in the same request.
   *  - A restored slot the user didn't touch has no binary to attach
   *    (its `file` is just a zero-byte placeholder — see
   *    patchSupportingDocs), so it reports back the fileName/fileSize it
   *    was originally restored with, so the backend knows this slot's
   *    existing file is still intact rather than reading "no file info"
   *    as "the file was removed."
   *  - Anything else (URL-only / empty slot) has no file info to give. */
  private resolveDocFileMeta(doc: SupportingDoc): { fileName?: string; fileSize?: number } {
    if (doc.file && doc.file.size > 0) {
      return { fileName: doc.file.name, fileSize: doc.file.size };
    }
    if (doc.originalFileName) {
      return { fileName: doc.originalFileName, fileSize: doc.originalFileSize };
    }
    return {};
  }

  async onDocSubmit(): Promise<void> {
    if (!this.canEdit) {
    this.toastr.error('You do not have permission to submit supporting documents.', 'Access Denied');
    return;
  }
  if (this.isDraftConcept) {
    this.toastr.error(
      'This concept is still a draft. Please submit the Concept Development tab first before adding Supporting Documents.',
      'Concept Not Submitted'
    );
    return;
  }
  if (this.isSupportingDocUploading) {
    this.toastr.error('Please wait for all files to finish uploading.', 'Upload in progress');
    return;
  }
    const user_id = Number(sessionStorage.getItem('userId'));
    if (!this.conceptId) {
      this.toastr.error(
        'Please save the concept first before submitting supporting documents.',
        'Concept not saved'
      );
      return;
    }

    // Only include docs that have a file, URL, or PDF location filled in.
    const validDocs = this.supportingDocs.filter(
      d => d.file || d.sourceurl?.trim() || d.pdfLocation?.trim()
    );

    if (validDocs.length === 0) {
      this.toastr.error(
        'Please add at least one supporting document before submitting.',
        'No documents'
      );
      return;
    }

    this.loading = true;

    try {
      // Lean metadata — only Supporting Documents payload + completion flags.
      // fileName/fileSize is resolved per-doc below: a freshly-picked file
      // reports its own name/size (and its binary goes out alongside, see
      // the forEach below); a restored-but-untouched slot has no binary to
      // attach, so it reports back the fileName/fileSize it was restored
      // with — without this, an unmodified slot looks file-less to the
      // backend on every resubmit and its existing file association gets
      // wiped, even though nothing about it actually changed.
      const sdMetadata = {
        concept_id:                   this.conceptId,
        SupportingDocumentsCompleted: 1,
        supportingDocs: validDocs.map(d => {
          const { fileName, fileSize } = this.resolveDocFileMeta(d);
          return {
            name:        d.name,
            sourceurl:   d.sourceurl,
            pdfLocation: d.pdfLocation,
            fileName,
            fileSize
          };
        })
      };

      // Single combined request: metadata + every doc's binary file (for
      // whichever docs actually have one) go out together in ONE
      // FormData/API call, instead of one call per doc (or per doc per
      // chunk) like before. 'doc_indices' ties each entry in 'files' back
      // to its position in sdMetadata.supportingDocs, since not every doc
      // necessarily has a file — some are URL/PDF-location-only and have
      // nothing to upload.
      const formData = new FormData();
      formData.append('concept_id', this.conceptId);
      formData.append('metadata',   JSON.stringify(sdMetadata));
      formData.append('category',  'supporting_docs');
      formData.append('user_id',    user_id.toString());

      validDocs.forEach((doc, i) => {
        if (!doc.file || doc.file.size === 0) return; // URL-only doc — nothing to upload
        formData.append('files',       doc.file, doc.file.name);
        formData.append('doc_indices', i.toString());
        formData.append('doc_names',   doc.name || doc.file.name);
        formData.append('source_urls', doc.sourceurl || '');
        formData.append('file_names',  doc.file.name);
        formData.append('file_sizes',  doc.file.size.toString());
      });

      const res: any = await this.service.submitsupportingdocuments(formData).toPromise();
      if (res?.status === 'error' || res?.detail) {
        this.toastr.error(res?.detail || res?.message || 'Something went wrong', 'Error');
        return;
      }

      // Mark every doc complete now that the single request has succeeded
      // (no per-chunk progress to track anymore).
      validDocs.forEach(doc => {
        const globalIndex = this.supportingDocs.indexOf(doc);
        if (globalIndex !== -1) {
          this.supportingDocs[globalIndex] = { ...this.supportingDocs[globalIndex], uploadProgress: 100 };
        }
      });
      this.supportingDocs = [...this.supportingDocs];

      this.supportingDocumentsCompleted = 1;
      this.toastr.success('Supporting documents submitted successfully!', 'Success');

      // Refresh the left panel + soft-reload this concept's data so the
      // page reflects exactly what was just persisted — no full page
      // reload.
      this.loadLatestUpdates();
      this.refreshConceptData(this.conceptId);

    } catch (err: any) {
      const msg =
        err?.error?.detail  ||
        err?.error?.message ||
        err?.message        ||
        'Upload failed. Please try again.';
      this.toastr.error(msg, 'Error');
    } finally {
      this.loading = false;
    }
  }

  // ── Latest Updates list ────────────────────────────────────────────────
  // Shows EVERY concept in the system, regardless of who created it or
  // what role is currently logged in — this is the shared, read-only
  // visibility layer everyone gets, separate from the edit restrictions
  // enforced elsewhere (applyRoleRestrictions / refreshAllowedStatuses).
  // Uses /api/latest-updates (unfiltered, Concepts UNION active
  // ConceptDrafts) rather than /api/dashboard-concepts, which only reads
  // the Concepts table and silently omits anything still saved as a
  // draft — or getConceptsByUserId, which only returns the current
  // user's own concepts and drafts.
private loadLatestUpdates(): void {
  this.latestUpdatesLoading = true;

  this.service.getLatestUpdates().subscribe({
    next: (res) => {
      const concepts: any[] = res?.data ?? [];

      this.latestConcepts = concepts
        .slice() // avoid mutating the response array in place
        .sort((a, b) =>
          new Date(b.CreatedDate).getTime() -
          new Date(a.CreatedDate).getTime()
        )
        .map(c => ({
          ...c,
          statusClass: this.getStatusClass(c.DevelopmentStatus),
          // IsDraft now comes straight from the backend (0/1 or bool
          // depending on the SQL driver), instead of being hardcoded
          // false — that hardcoding was exactly why drafts never showed
          // up here even though this list is supposed to be unfiltered.
          isDraft: !!(c.IsDraft ?? c.isDraft)
        }));

      this.latestUpdatesLoading = false;
    },
    error: (err) => {
      console.error('Failed to load latest updates:', err);
      this.latestUpdatesLoading = false;
    }
  });
}

getStatusClass(status: string): string {
  switch (status) {
    case 'New':
      return 'lu-new';

    case 'Programming Queue':
    case 'Programming':
    case 'Researching':
      return 'lu-progress';

    case 'Result Set QA':
    case 'QA Revise':
      return 'lu-qa';

    case 'Approved':
      return 'lu-approved';

    case 'Client Review':
    case 'Client Revise':
    case 'Client Resubmit':
      return 'lu-client-review';

    case 'Client Approved':
      return 'lu-client-approved';

    case 'Client Denied':
      return 'lu-client-denied';

    case 'Pre-Production':
      return 'lu-preproduction';

    case 'Production':
      return 'lu-production';

    case 'Closed':
      return 'lu-closed';

    case 'Hold':
    case 'Revisit':
      return 'lu-hold';

    case 'Superseded':
      return 'lu-superseded';

    default:
      return '';
  }
}
// onSelectLatestConcept(item: LatestConceptItem): void {
//   if (item.conceptId === this.conceptId) return;
//   this.isEditMode = true;
//   this.conceptId  = item.conceptId;
//   this.loadConcept(item.conceptId);
// }
onSelectLatestConcept(item: LatestConceptItem): void {
  // MUST route on the stable anchor (ConceptId), never the version/display
  // id (CurrentConceptId). Routing on CurrentConceptId sends a display id
  // back to the server as concept_id on the next Update; the backend won't
  // recognize it as an existing anchor and will insert a brand-new
  // ConceptKeys/Concepts row instead of updating the original one.
  if (item.ConceptId === this.conceptId) return;
  this.router.navigate(['/concept-create', item.ConceptId]);
}

loadUserFiles(): void {
  const user_id = Number(sessionStorage.getItem('userId'));
  if (!user_id) {
    return;
  }

  this.service.getuserfiles(user_id).subscribe({
    next: (res) => {
      console.log('User Files:', res);

      // Populate supporting documents here
      // this.supportingDocs = res.data;
    },
    error: (err) => {
      console.error('Failed to load user files', err);
      this.toastr.error('Failed to load supporting documents', 'Error');
    }
  });
}

private static validDateRange(control: import('@angular/forms').AbstractControl) {
  const val: string = control.value;
  if (!val) return null;
  const year = new Date(val).getFullYear();
  if (isNaN(year) || year < 1900 || year > 3000) {
    return { invalidDateRange: true };
  }
  return null;
}

/** Rejects any date before today — backs up the [min] attribute on the
 *  date input, since native min/max can be bypassed by manual keyboard
 *  entry in some browsers (notably Firefox). Compares by calendar day,
 *  not time-of-day, so "today" itself is always valid regardless of
 *  current time. */
private static notPastDate(control: import('@angular/forms').AbstractControl) {
  const val: string = control.value;
  if (!val) return null;
  const selected = new Date(val);
  selected.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (selected < today) {
    return { pastDate: true };
  }
  return null;
}

limitToDigits(event: Event, controlName: string, maxDigits: number = 9): void {
  const input = event.target as HTMLInputElement;
  let value = input.value.replace(/\D/g, ''); // strip non-digits

  if (value.length > maxDigits) {
    value = value.slice(0, maxDigits);
  }

  input.value = value;
  this.form.get(controlName)?.setValue(value ? Number(value) : null, { emitEvent: false });
}
}