import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ConceptCreateComponent } from './concept-create';

describe('ConceptCreate', () => {
  let component: ConceptCreateComponent;
  let fixture: ComponentFixture<ConceptCreateComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ConceptCreate]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ConceptCreate);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
