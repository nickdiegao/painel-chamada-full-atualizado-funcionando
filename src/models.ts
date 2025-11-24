export type SectorStatus = 'Aberto' | 'Restrito';
export type PhysicianStatus = 'Disponível' | 'Ocupado' | 'Ausente';
export type Route = 'Sala Vermelha' | 'Sala Amarela' | 'Sala Verde' | 'Aguardando';

export interface Sector {
  id: string;
  name: string;
  status: SectorStatus;
  reason?: string;          // motivo da restrição (texto)
  etaMinutes?: number;      // previsão estimada em minutos
  instruction?: string;     // mensagem orientativa curta
}

export interface Physician {
  id: string;
  name: string;
  availabilityStatus: PhysicianStatus;
}

export interface Patient {
  id: string;
  name: string;
  routedTo: Route;
}

// novo payload para vídeo
export type PlayVideoPayload = {
  videoId: string;
  start?: number; // segundos
  mute?: boolean;
};

// stop não precisa payload, mas mantemos objeto vazio para consistência
export type StopVideoPayload = {};

// atualize PanelUpdate para incluir playVideo/stopVideo
export type PanelUpdate =
  | { type: 'snapshot'; payload: { sectors: Sector[]; physicians: Physician[]; patients: Patient[] }; timestamp: string }
  | { type: 'sector'; payload: Sector; timestamp: string }
  | { type: 'physician'; payload: Physician; timestamp: string }
  | { type: 'patient'; payload: Patient; timestamp: string }
  | { type: 'playVideo'; payload: PlayVideoPayload; timestamp: string }
  | { type: 'stopVideo'; payload: StopVideoPayload; timestamp: string };


