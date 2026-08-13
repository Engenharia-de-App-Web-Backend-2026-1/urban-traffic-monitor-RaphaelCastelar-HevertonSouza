export interface TrafficReading {
  readingId: string;
  sensorId: string;
  latitude: number;
  longitude: number;
  averageSpeedKmh: number;
  vehicleCount: number;
  occupancyPercent: number;
  capturedAt: string;
}

export interface AnalysisResult {
  readingId: string;
  status: 'NORMAL' | 'CONGESTED' | 'ACCIDENT';
  accidentDetected: boolean;
  eventId: string;
  severity: 'NONE' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  message: string;
}

export interface AccidentEvent extends AnalysisResult {
  type: 'ACCIDENT_DETECTED';
  sensorId: string;
  latitude: number;
  longitude: number;
  detectedAt: string;
}
