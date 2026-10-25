import {
  BarChart,
  CustomChart,
  GaugeChart,
  LineChart,
  PieChart,
} from "echarts/charts";
import { GridComponent, VisualMapComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";

/** Registers the narrow canvas-only ECharts feature set required by YunariChart.
 * `VisualMapComponent` carries per-value line-threshold colouring (§85); without
 * it ECharts accepts the option and silently draws one colour. */
echarts.use([
  GaugeChart,
  LineChart,
  BarChart,
  // The segmented bar's bands are a custom series; without this registration
  // the engine accepts the option and draws nothing.
  CustomChart,
  PieChart,
  GridComponent,
  VisualMapComponent,
  CanvasRenderer,
]);
