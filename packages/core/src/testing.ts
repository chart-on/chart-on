/**
 * Test support for apps and adapters built on the chart, published as
 * `@charton/core/testing`. Nothing in the main entry imports it.
 */
export { testDataSource } from './data/conformance';
export type { DataSourceCheckOptions } from './data/conformance';
export { describeScene, driveFrames, emitPointer, flushFrames, installTestEnvironment, sampleBars, waitForData } from './testing/kit';
export type {
  PointerAt,
  SampleBarsOptions,
  SceneDescription,
  ScenePane,
  SceneSeries,
  TestEnvironment,
  TestEnvironmentOptions,
} from './testing/kit';
