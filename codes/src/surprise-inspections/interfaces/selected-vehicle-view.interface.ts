import { InspectionResult, InspectionStatus } from '@prisma/client';

/** A picked vehicle and the surprise inspection created for it, as returned by the API. */
export interface SelectedVehicleView {
  id: string;
  registrationNo: string;
  inspection: {
    id: string;
    status: InspectionStatus;
    /** Null until the garage reports the inspection result. */
    result: InspectionResult | null;
  } | null;
}
