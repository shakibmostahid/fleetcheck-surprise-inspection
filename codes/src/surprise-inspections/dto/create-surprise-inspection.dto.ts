import { IsNumber, IsPositive, Max } from 'class-validator';
import { FindSurpriseInspectionDto } from './find-surprise-inspection.dto';

export class CreateSurpriseInspectionDto extends FindSurpriseInspectionDto {
  /** Share of eligible vehicles to pick, e.g. 25 for 25%. */
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(100)
  percentage!: number;
}
