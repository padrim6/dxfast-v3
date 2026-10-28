// Delegate to the generalized boundsCoherence suite
import { runBoundsCoherence } from './boundsCoherence';

runBoundsCoherence('rect_plate').catch((err) => {
  console.error(err);
  process.exit(1);
});
