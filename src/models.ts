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

export interface PanelUpdate {
  type: 'sector' | 'physician' | 'patient' | 'snapshot';
  payload: any;
  timestamp: string;
}
