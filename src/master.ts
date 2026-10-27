export const BRANCHES = ['BONE', 'KENDARI', 'MAKASSAR', 'PARE-PARE'] as const;
export type Branch = (typeof BRANCHES)[number];
export interface StoMaster { branch: Branch; lis: number }

// Hanya mapping dan customers dari unspec-riwayat.json, tanpa snapshot tiket lama.
export const MASTER: Record<string, StoMaster> = {
  BBU: { branch: 'KENDARI', lis: 14416 },
  RAH: { branch: 'KENDARI', lis: 3253 },
  WNC: { branch: 'KENDARI', lis: 2262 },
  KDR: { branch: 'KENDARI', lis: 15621 },
  KKA: { branch: 'KENDARI', lis: 5543 },
  LSS: { branch: 'KENDARI', lis: 1908 },
  PMA: { branch: 'KENDARI', lis: 2466 },
  MDG: { branch: 'KENDARI', lis: 30779 },
  UNH: { branch: 'KENDARI', lis: 7433 },
  BAL: { branch: 'MAKASSAR', lis: 20028 },
  MAT: { branch: 'MAKASSAR', lis: 21017 },
  BLK: { branch: 'BONE', lis: 6942 },
  BTN: { branch: 'BONE', lis: 3307 },
  JNP: { branch: 'MAKASSAR', lis: 3842 },
  SLY: { branch: 'BONE', lis: 2342 },
  SIN: { branch: 'BONE', lis: 4640 },
  WTP: { branch: 'BONE', lis: 10863 },
  MAR: { branch: 'MAKASSAR', lis: 5463 },
  PKN: { branch: 'MAKASSAR', lis: 6121 },
  ANT: { branch: 'MAKASSAR', lis: 8618 },
  PNK: { branch: 'MAKASSAR', lis: 30173 },
  KIM: { branch: 'MAKASSAR', lis: 2092 },
  SUD: { branch: 'MAKASSAR', lis: 14662 },
  MAL: { branch: 'MAKASSAR', lis: 629 },
  SUG: { branch: 'MAKASSAR', lis: 19365 },
  TKA: { branch: 'MAKASSAR', lis: 4968 },
  TMA: { branch: 'MAKASSAR', lis: 11331 },
  MAJ: { branch: 'PARE-PARE', lis: 4506 },
  MMS: { branch: 'PARE-PARE', lis: 1436 },
  PLW: { branch: 'PARE-PARE', lis: 4672 },
  WON: { branch: 'PARE-PARE', lis: 3347 },
  MAK: { branch: 'PARE-PARE', lis: 4593 },
  RTP: { branch: 'PARE-PARE', lis: 7306 },
  MAM: { branch: 'PARE-PARE', lis: 10503 },
  MAS: { branch: 'PARE-PARE', lis: 5703 },
  MLL: { branch: 'PARE-PARE', lis: 1688 },
  SRK: { branch: 'PARE-PARE', lis: 5643 },
  PLP: { branch: 'PARE-PARE', lis: 18335 },
  BAR: { branch: 'MAKASSAR', lis: 3989 },
  PRE: { branch: 'PARE-PARE', lis: 13462 },
  PIN: { branch: 'PARE-PARE', lis: 8478 },
  ENR: { branch: 'PARE-PARE', lis: 2777 },
  RPN: { branch: 'PARE-PARE', lis: 1823 },
  SID: { branch: 'PARE-PARE', lis: 6342 },
  TTE: { branch: 'PARE-PARE', lis: 889 },
  AJN: { branch: 'BONE', lis: 476 },
  CGI: { branch: 'BONE', lis: 1873 },
  SIW: { branch: 'BONE', lis: 812 },
  SKG: { branch: 'BONE', lis: 9218 },
  WTG: { branch: 'BONE', lis: 4127 }
};

// STO di luar 4 branch yang dikenal dashboard: dikecualikan, bukan dianggap error.
export const EXCLUDED_STOS = new Set(
  'ABO,PAO,BUL,MSH,NIR,NML,NMR,SPR,WHA,DOB,LRA,SML,TUA,TIA,GTL,LBT,TLG,ISM,KWD,MRS,MRA,AGT,BAD,MRK,TMR,SNI,SRM,SMI,WAM,ABE,WAE,JAP,JPA,JPB,BIA,SRU,KUK,BAH,BIT,AMD,BEO,HLS,KAU,TAG,THN,AMR,BOR,KTG,LOL,MOL,TUT,LBH,MGL,SNN,SSI,MDO,LAN,TDN,TMH,PIK,JLL,SFI,TNT,GLL,MTA,TOB,BGI,BUT,LWU,PGM,APN,BKU,KOL,DGL,PLA,PLB,TWL,PLC,KOR,MOT,BUO,PGI,TLY,TNB,TOL,PSO,TEN,TBG,TIM,NAB,FFA,KIN,BTI,MWR,RSK,WMR,SON,TMB,PKA,GSA,BAM,BRU,KTB,MGG,KJN,PTG,MKM,BTK,LAB,LIK,PNJ,KRO,TNG,SKU,MJW,SEP,AGN,SAN,SBR,SGK,PAA,SMR,SEM,PLL,MLA,BLN,KBG,TGG,TSN,KOB,STT,MBD,BOT,LMP,LKT,TMD,LOB,TRK,LNN,TLA,TBY,MLN,TPE,SNY,TSL,JWT,TRD,NNK,TAJ,BBR,MRB,MTP,BJM,KYG,BLC,KIP,KPL,PGT,SER,STI,TRJ,BTB,LUL,PLE,TKI,AMT,BRI,KDG,NEG,PGN,RTA,TJL,GMB,ULI,PLK,PYM,KKP,KRI,AMP,SUA,KMI,SAI,HNU,SAD,KSO,PRC,KPB,PPS,KKY,PEA,KKN,PBU,BNT,MTW,TML,LMD,STA,PTK,SAO,SRY,JAW,SRD,SEI,KTP,BKY,SNW,KKU,NPN,SMB,MPW,SGU,TBA,SED,NGG,SPY,KWN,STG,BDO,SDR,BIG,RBA,ANJ,PUT,PMK'.split(',')
);
