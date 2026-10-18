import type {Directive} from 'vue';
// mdui 2 does not forward host aria-label to its shadow focus control.
// Wait for Lit rendering, then give that actual control its accessible name.
type LabelledElement=HTMLElement&{updateComplete?:Promise<unknown>};
const mirror=async(element:LabelledElement)=>{
 await element.updateComplete;
 const field=element.shadowRoot?.querySelector<LabelledElement>('mdui-text-field');
 await field?.updateComplete;
 const control=field?.shadowRoot?.querySelector('input')||element.shadowRoot?.querySelector('button,input,select');
 const label=element.getAttribute('aria-label')||element.getAttribute('label');
 if(label&&control)control.setAttribute('aria-label',label);
 if(control&&element.dataset.controlRole){
  control.setAttribute('role',element.dataset.controlRole);
  for(const name of ['aria-valuenow','aria-valuemin','aria-valuemax']){
   const value=element.getAttribute(name);
   if(value!==null)control.setAttribute(name,value);
  }
 }
};
export const controlLabel:Directive<LabelledElement>={mounted:element=>{void mirror(element);},updated:element=>{void mirror(element);}};
