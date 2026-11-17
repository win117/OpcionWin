import { childSchema, ruleFields, validateRule } from './shared';

// Subdocumento de PerfilAnalisis; se conserva una copia en cada evaluación.
const schema = childSchema(ruleFields());
validateRule(schema);
export default schema;

