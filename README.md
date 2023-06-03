```mermaid
graph LR
    B(EL-sync-driver) -- fork_choice dump --> C[CL REST API]
    C -- forkChoiceState --> B
    B -- engine_forkChoiceUpdatedV2 --> D[EL engine API]
```