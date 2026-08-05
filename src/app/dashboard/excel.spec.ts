import { TestBed } from '@angular/core/testing';

import { Excel } from './excel';

describe('Excel', () => {
  let service: Excel;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(Excel);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
