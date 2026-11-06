import type {RegistryFormField,RegistryFormSection} from '../types';
import {languageService} from '../services/languageService';
import {INITIAL_REGISTRY_FORM_SCHEMA} from '../data/initialFormSchema';
export function registryFieldLabel(field:RegistryFormField) {
 const language=languageService.getLanguage();
 if(language==='ceb'&&field.labelCeb)return field.labelCeb;
 if(language==='fil'&&field.labelFil)return field.labelFil;
 if(field.isCustom)return field.label;
 return languageService.t(`ui.${field.label}`,field.label);
}
export function registrySectionTitle(section:RegistryFormSection) {
 const original=INITIAL_REGISTRY_FORM_SCHEMA.sections.find(item=>item.id===section.id);
 return original?.title===section.title?languageService.t(`ui.${section.title}`,section.title):section.title;
}
