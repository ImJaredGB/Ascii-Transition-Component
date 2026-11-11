import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AsciitransitionComponent } from './asciitransition-component';

describe('AsciitransitionComponent', () => {
  let component: AsciitransitionComponent;
  let fixture: ComponentFixture<AsciitransitionComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AsciitransitionComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AsciitransitionComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
