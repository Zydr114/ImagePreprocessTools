import type {Directive} from 'vue';
// mdui 2 does not forward host aria-label to its shadow focus control.
// Wait for Lit rendering, then give that actual control its accessible name.
type LabelledElement=HTMLElement&{updateComplete?:Promise<unknown>};
const mirror=async(element:LabelledElement)=>{
 await element.updateComplete;
 const control=element.shadowRoot?.querySelector('button,input,select');
 const label=element.getAttribute('aria-label');
 if(label&&control)control.setAttribute('aria-label',label);
};
export const controlLabel:Directive<LabelledElement>={mounted:element=>{void mirror(element);},updated:element=>{void mirror(element);}};
