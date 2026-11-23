export const TRAIN_BOARDING_X = -15;
export const TRAIN_WIDTH = 4.2;
export const TRAIN_NOSE_LENGTH = 3.8;
export const KTX_RAIL_EXTENSION = 240;
export const KTX_DEPARTURE_SECONDS = 18;
export const KTX_EMERGENCY_INFECTED = 3;
export const KTX_QUARANTINE_SECONDS = 25;
export const TRAIN_SEAT_SIDES = [-1.7, -1.17, 1.17, 1.7];

function makeTrainLayout(carCount: number, carPitch: number, rowsPerEnd: number) {
  const carLength = carPitch - 0.6;
  const centers = Array.from({ length: carCount }, (_, index) => TRAIN_BOARDING_X + index * carPitch);
  const rearX = centers[0] - carLength / 2;
  const frontX = centers[carCount - 1] + carLength / 2;
  const seatRows = [-1, 1].flatMap((side) =>
    Array.from({ length: rowsPerEnd }, (_, row) => side * (2.35 + row * 0.89))
  );
  return {
    carCount, carPitch, carLength, centers, rearX, frontX, seatRows,
    bulkheads: centers.slice(0, -1).map((center) => center + carPitch / 2),
    capacity: carCount * seatRows.length * TRAIN_SEAT_SIDES.length
  };
}

export type TrainLayout = ReturnType<typeof makeTrainLayout>;

const expressLayout = makeTrainLayout(6, 20, 8);
const localLayout = makeTrainLayout(3, 15, 5);

export function getTrainLayout(layeredTerminal: boolean): TrainLayout {
  return layeredTerminal ? expressLayout : localLayout;
}
