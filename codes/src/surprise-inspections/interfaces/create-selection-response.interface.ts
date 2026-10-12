import { SelectionView } from './selection-view.interface';

/** Response body of POST /admin/surprise-inspections. */
export interface CreateSelectionResponse {
  /** False when a selection already existed for this company and quarter. */
  created: boolean;
  selection: SelectionView;
}
