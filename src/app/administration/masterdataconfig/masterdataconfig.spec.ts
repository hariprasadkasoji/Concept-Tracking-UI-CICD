import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Masterdataconfig } from './masterdataconfig';

describe('Masterdataconfig', () => {
  let component: Masterdataconfig;
  let fixture: ComponentFixture<Masterdataconfig>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Masterdataconfig]
    })
    .compileComponents();

    fixture = TestBed.createComponent(Masterdataconfig);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
