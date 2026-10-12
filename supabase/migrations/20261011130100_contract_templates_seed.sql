-- Master Services Agreement v1: English (official) and French translation,
-- generated from the LevelUp legal drafts with the placeholders filled in.
-- Newer versions are published from /dashboard/exclusive/contracts.

insert into public.contract_templates (key, version, locale, title, body, published_at)
values
  ('msa', 1, 'en', 'Master Services Agreement', $msa_en$**LevelUp Ecosystem**
Effective date: the date the Client signs electronically (see the signature certificate)
Last updated: October 11, 2026

---

> ### The short version
>
> - This Agreement applies when you pay LevelUp to design, build, host, maintain or support a website or web application.
> - **You get a license to use your website for as long as your platform/care plan is active. LevelUp keeps ownership of the code, templates, components, platform and database structure. You own your content, brand and customer data.** A code buy-out is available on a separate written agreement.
> - Builds: 50% deposit to book and start the project (earned once work begins), balance at launch. Care/platform plans: billed monthly in advance; cancel with 30 days' notice.
> - Invoices are due in 14 days. Reminders at day 1, 7 and 14 overdue; suspension after 30 days overdue (with 7 days' notice); termination after 90 days overdue (with 14 days' notice), followed by a 30-day export window. Your data is always returned to you on request.
> - Revisions, acceptance, support and response targets are defined below. We aim for 99.5% monthly availability on care plans and credit you if we fall short for reasons in our control.
> - Liability is capped at fees paid in the prior 12 months. California law; arbitration in San Diego County.

---

## 1. Parties, structure and definitions

1.1 This Master Services Agreement ("**Agreement**") is between LevelUp Ecosystem, San Diego, California, USA (postal address available on request) ("**LevelUp**"), and the client identified in an Order ("**Client**").

1.2 **Structure.** Each proposal, quote, statement of work, order form or online checkout accepted by Client (an "**Order**") is governed by this Agreement. This Agreement incorporates the [Terms of Service](https://levelup-ecosystem.com/terms) ("**Terms**"), the [Acceptable Use Policy](https://levelup-ecosystem.com/acceptable-use), the [Privacy Policy](https://levelup-ecosystem.com/privacy) and, where Client Data includes personal data, the [Data Processing Addendum](https://levelup-ecosystem.com/dpa). Capitalized terms not defined here have the meanings in the Terms.

1.3 **Definitions.**
- "**Build Services**": one-time design and development of a website, application, template customization or feature, as described in an Order.
- "**Platform/Care Plan**": the recurring plan that provides hosting on the Platform, database, security, updates, backups, Dashboard access, support and any included update time.
- "**Deliverables**": the Client Site and other items described in an Order. Deliverables consist of LevelUp Materials configured with Client Materials.
- "**Launch**": the date the Client Site is first made publicly available on Client's domain, or on a LevelUp subdomain at Client's request.
- "**Business Day**": Monday–Friday, excluding U.S. federal holidays, Pacific Time.

## 2. Build Services

2.1 **Process.** Unless the Order says otherwise, a build follows: (a) kickoff and discovery; (b) Client supplies content and access; (c) design direction (homepage or key template); (d) build of remaining pages and features; (e) review and revisions; (f) acceptance and Launch.

2.2 **Client content.** Client will provide text, images, logos, service lists, prices, legal pages specific to Client's business, and any required approvals by the dates in the Order or, if none, within 10 Business Days of request. LevelUp may use placeholder or AI-assisted draft content, clearly identified, which Client must review and approve before Launch.

2.3 **Revisions.** Each Order states the number of included revision rounds (for example: Starter 2 rounds, Business 3 rounds). A "round" is one consolidated list of changes submitted in writing for a deliverable. Changes that alter approved structure, add pages or features, or exceed included rounds are Change Requests.

2.4 **Change Requests.** Additional work requires a written Change Request (e-mail is sufficient) with a price and schedule impact approved by Client. Unless otherwise quoted, additional work is billed at LevelUp's then-current hourly rate (currently US$95/hour) in 15-minute increments.

2.5 **Acceptance.** When LevelUp delivers a Deliverable for review, Client has 7 Business Days to either accept it or provide a written list of material non-conformities with the Order. LevelUp will correct material non-conformities and redeliver. A Deliverable is deemed accepted at the earlier of: (a) Client's written acceptance; (b) expiry of the review period without a written list of non-conformities; or (c) Launch at Client's request. Minor issues that do not prevent use do not delay acceptance and will be fixed under Section 2.7.

2.6 **Client delays.** Timelines depend on Client's timely input. If Client does not respond to a request for content, feedback or approval for 30 days, LevelUp may pause the project and reschedule it based on availability. If the delay exceeds 60 days, LevelUp may, after 10 days' written notice, close the project, invoice for work performed to date (at the hourly rate, up to the full build fee) and apply the deposit to that invoice. A reactivation fee of US$150 may apply to resume a closed project.

2.7 **Post-launch fix period.** For 30 days after Launch, LevelUp will fix, at no charge, defects that cause the Deliverables to materially fail to function as described in the Order. This does not cover changes in scope, Client edits, third-party changes, or browsers/devices not listed as supported.

2.8 **Accessibility and SEO.** LevelUp builds with reasonable accessibility practices (targeting WCAG 2.1/2.2 Level AA for LevelUp-controlled templates) and technical SEO foundations. Because content, images, third-party tools and future edits are controlled by Client, LevelUp does not warrant full legal accessibility compliance or any search ranking. Accessibility audits and remediation are available as an add-on.

## 3. Platform/Care Plans

3.1 **Required plan.** Because Client Sites run on the Platform, an active Platform/Care Plan is required for a Client Site to remain online, unless a Code Buy-Out and migration have been completed.

3.2 **Included services.** Each plan includes the services described in its Order or on the pricing page at the time of purchase, typically: hosting and content delivery; managed database; SSL/TLS certificates; security headers and monitoring; platform and dependency updates; automated backups; uptime monitoring; Dashboard access; and a stated amount of monthly update time and support response targets. Unused update time does not roll over.

3.3 **What is not included** (unless stated in the Order): new pages or features; redesigns; copywriting; photography; paid advertising; third-party license fees; legal, tax or compliance advice; recovery from damage caused by Client or Client's other vendors; and work outside Business Days.

3.4 **Support and response targets.** Support requests are submitted through the Dashboard or by e-mail. LevelUp aims to respond within the targets below (targets, not guarantees):

| Severity | Example | Target first response |
|---|---|---|
| Critical | Site down, security incident, booking system unavailable | 4 business hours (Premium plans: 2 business hours) |
| High | Major feature broken, no workaround | 1 Business Day |
| Normal | Content update, minor bug | 2 Business Days |
| Low | Questions, suggestions | 5 Business Days |

3.5 **Availability target and service credits (SLA-lite).** LevelUp targets 99.5% monthly availability of Client Sites on paid Platform/Care Plans, measured by LevelUp's external monitoring, excluding: scheduled maintenance announced at least 24 hours in advance (or emergency maintenance); outages caused by Client, Client's content, Client's DNS/domain/registrar or third-party services Client chose; force majeure; suspension under this Agreement; and beta features. If availability in a calendar month falls below 99.0% for reasons within LevelUp's reasonable control, Client may request, within 30 days after the month ends, a credit of 10% of that month's plan fee (25% if below 97%). Credits are applied to future invoices, are capped at 50% of the monthly fee, have no cash value, and are Client's sole and exclusive remedy for unavailability.

3.6 **Cancellation.** Client may cancel a monthly Platform/Care Plan at any time with 30 days' written notice (Dashboard or e-mail); fees are not prorated for partial months. Annual plans may be cancelled effective at the end of the annual term; if an Order grants a discounted annual price or bundles a year of care with a build, early cancellation does not entitle Client to a refund of the bundled year unless required by law. Cancellation results in the effects described in Section 9.

3.7 **Minimum term.** If an Order states a minimum term (for example, 12 months for bundled packages or reduced build pricing), Client agrees to pay the plan fee for that minimum term. If Client cancels early, the remaining fees for the minimum term become due, **reduced** to the extent LevelUp's costs are saved — or, where the Order provides a discounted build price in exchange for the minimum term, Client may instead pay the difference between the standard and discounted build price, whichever is lower.

## 4. Fees and payment

4.1 **Build deposits.** Unless the Order states otherwise: 50% of the build fee is due on acceptance of the Order ("**Deposit**") and the remaining 50% is due at Launch or deemed acceptance, whichever comes first. Projects above US$5,000 may use milestones (for example 40% / 30% / 30%). LevelUp does not start work or reserve schedule capacity until the Deposit is received.

4.2 **Deposit is earned on commencement.** The Deposit compensates LevelUp for reserving production capacity, discovery, planning and initial design work. It is fully refundable if Client cancels before work starts (kickoff call or first deliverable, whichever is first). Once work has started, the Deposit is **non-refundable**, and is applied against work performed. If Client terminates after work starts, Client pays for work performed through termination at the hourly rate (credited against the Deposit), up to the full build fee; if work performed is less than the Deposit, LevelUp retains the Deposit as a reasonable estimate of its reserved capacity and lost opportunity costs, which the parties agree are difficult to calculate precisely.

4.3 **Recurring fees.** Platform/Care Plan fees are billed in advance on a monthly (or annual) basis starting at Launch, or at the date stated in the Order, by automatic charge to Client's payment method on file or by invoice.

4.4 **Invoices and due date.** Invoices are due within 14 days of the invoice date ("**Net 14**") unless the Order states otherwise. Payment is in U.S. dollars.

4.5 **Non-payment process.** If an amount is not paid when due:

| Days past due | What happens |
|---|---|
| 0 (due date) | Automatic payment retry (if card on file) and friendly e-mail reminder. |
| 7 | Second reminder. |
| 14 | Third reminder. Late charge begins to accrue (Section 4.6). |
| 23 | **Suspension notice** by e-mail: suspension will occur in at least 7 days if unpaid. |
| 30 | **Suspension**: LevelUp may suspend Dashboard access, updates and support, and may replace the public Client Site with a neutral "temporarily unavailable" page. No data is deleted. |
| 76 | **Termination notice** by e-mail: termination will occur in at least 14 days if unpaid. |
| 90 | **Termination** of the affected Order(s) and license. The 30-day export window under Section 9 begins. |
| 90 + 30 | Deletion of Client Data per Section 9, after a final reminder e-mail. |

Notices are sent to the billing and primary account e-mail addresses. Client may avoid suspension or termination at any point by paying the overdue amount or agreeing a written payment plan. Partial payments are applied to the oldest invoices first. LevelUp will not suspend for an amount Client disputes in good faith in writing before the due date, as long as Client pays the undisputed portion and cooperates to resolve the dispute promptly.

4.6 **Late charges and collection.** Amounts more than 14 days overdue bear a late charge of 1.0% per month (or the highest rate permitted by law, if lower), calculated on the overdue balance. The parties agree this is a reasonable estimate of LevelUp's administrative and financing costs of late payment. A reinstatement fee of US$50 applies to restore a suspended Client Site. Client will reimburse reasonable costs of collection, including reasonable attorneys' fees where permitted (California Civil Code § 1717 makes such clauses reciprocal).

4.7 **Chargebacks.** Client agrees to raise billing disputes with LevelUp before contacting its bank. A chargeback for amounts properly owed is a material breach; LevelUp may suspend Services while the chargeback is pending and recover processor dispute fees (currently up to US$25 per dispute) if the chargeback is resolved in LevelUp's favor.

4.8 **Taxes.** Fees exclude taxes. Client pays all applicable sales, use, VAT/GST and similar taxes (other than LevelUp's income taxes). Where withholding is required, Client will gross up payments so LevelUp receives the full amount.

4.9 **Price changes.** LevelUp may change recurring fees with at least 30 days' prior written notice, effective from the next billing period after the notice period (or at renewal for annual plans). Client may cancel before the change takes effect. Fixed-price builds in an accepted Order are not affected.

4.10 **Third-party costs.** Third-party fees (domains, premium fonts or plugins, paid APIs, SMS credits, stock media, paid AI usage above plan limits) are passed through at cost or as quoted, unless included in the plan.

## 5. Intellectual property and license

5.1 **LevelUp Materials.** LevelUp owns all LevelUp Materials as defined in the Terms (Section 3.2), including all code, designs, templates, layouts, components, the Platform, Dashboard, LevelStudio, database schemas and documentation, and all improvements made during the Services, even if developed specifically for Client. To the extent any rights in LevelUp Materials would otherwise vest in Client, Client assigns them to LevelUp.

5.2 **Client Materials.** Client owns Client Materials and Client Data, and grants LevelUp the license in Section 3.3 of the Terms.

5.3 **License to Client.** Upon payment of the applicable fees and for so long as Client's Platform/Care Plan is active and in good standing, LevelUp grants Client the license described in Section 3.4 of the Terms to use the Deliverables. The license ends on termination, subject to Section 9.

5.4 **Reuse.** LevelUp may reuse and license LevelUp Materials for other clients as described in Section 3.6 of the Terms, but never Client Materials, Client branding or trademarks, Client Data or Client's Confidential Information. LevelUp will not create, for another client, a site that is a copy of Client's site including its distinctive combination of content, branding and visual identity.

5.5 **Code Buy-Out.** Client may request a Code Buy-Out at any time. Options typically include: (a) a **perpetual license** to the project-specific front-end code, with a self-hosting package; or (b) an **assignment** of the project-specific code that LevelUp agrees in writing to assign, with a perpetual non-exclusive license to embedded shared components. A Code Buy-Out requires a separate written agreement signed by both parties, full payment of all outstanding fees and the buy-out price, and (if the site depends on the Platform database or Dashboard) a migration project to replace those dependencies. LevelUp may decline to transfer components it licenses from third parties or that form part of the Platform.

5.6 **Third-party and open-source components.** Deliverables may include open-source software and third-party assets licensed under their own terms, which govern those components.

5.7 **IP indemnity by LevelUp.** LevelUp will defend Client against third-party claims alleging that the LevelUp Materials, as provided by LevelUp and used in accordance with this Agreement, infringe a U.S. copyright or misappropriate a trade secret, and will pay damages finally awarded or agreed in settlement. If such a claim occurs or is likely, LevelUp may modify or replace the affected material, obtain a license, or terminate the affected Services and refund prepaid unused fees. This does not apply to claims arising from Client Materials, AI output that Client chose to publish, combinations with items not provided by LevelUp, modifications not made by LevelUp, or use after LevelUp has provided a non-infringing alternative. This Section states LevelUp's entire liability for IP infringement.

## 6. Data protection and access

6.1 **Roles.** For Client Data relating to Client's customers, site visitors and staff, Client is the "controller" (or "business") and LevelUp is the "processor" (or "service provider"). The DPA applies and controls on data-protection matters.

6.2 **Access.** LevelUp may access Client Sites, databases and Client Data only for the purposes listed in Section 8.1 of the Terms, subject to the confidentiality and security commitments in the Terms and DPA.

6.3 **Client compliance.** Client is responsible for having a lawful basis and providing required notices (including its own privacy policy and, where required, a cookie consent mechanism) for the personal data collected through the Client Site. LevelUp can provide templates as a convenience; they are not legal advice.

6.4 **Backups.** LevelUp maintains automated backups as part of the Platform. Backups are for disaster recovery; they are not an archive, and LevelUp does not guarantee recovery of data entered between backups.

## 7. Client obligations

Client will: (a) provide accurate information and timely cooperation; (b) designate a primary contact with authority to approve work; (c) comply with the Terms and AUP; (d) maintain rights to all Client Materials; (e) maintain its own domain registration (unless LevelUp manages it under Section 4.3 of the Terms) and keep payment details current; (f) comply with laws applicable to Client's industry and marketing; and (g) not ask LevelUp to implement anything unlawful (LevelUp may refuse any such request).

## 8. Warranties and disclaimers

8.1 **Mutual.** Each party warrants that it has authority to enter into this Agreement.

8.2 **LevelUp.** LevelUp warrants that it will perform the Services in a professional and workmanlike manner consistent with generally accepted industry standards. Client's exclusive remedy for breach of this warranty is re-performance of the non-conforming Services or, if LevelUp cannot re-perform within a reasonable time, a refund of the fees paid for the non-conforming Services. Claims must be made within 30 days after the Services were performed.

8.3 **Client.** Client warrants that Client Materials and Client's use of the Services do not violate law or third-party rights.

8.4 **Disclaimers.** Except as expressly stated in this Section 8, Section 10 of the Terms applies (as-is, no guarantee of rankings, revenue or uninterrupted availability, AI content, beta features, third-party services).

## 9. Term, termination and transition

9.1 **Term.** This Agreement starts on acceptance of the first Order and continues while any Order is in effect.

9.2 **Termination for cause.** Either party may terminate an Order if the other party materially breaches it and fails to cure within 15 days of written notice (or within the non-payment timeline in Section 4.5 for payment breaches). Either party may terminate immediately if the other becomes insolvent, makes an assignment for the benefit of creditors, or becomes subject to bankruptcy proceedings (to the extent permitted by law).

9.3 **Suspension.** LevelUp may suspend as provided in Section 6 of the Terms (including immediate suspension for illegal activity or security emergencies).

9.4 **Effect of termination.** On termination or expiration of an Order: (a) all unpaid fees for Services performed and committed minimum terms become due (subject to Section 3.7); (b) the license to use Deliverables ends and the Client Site may be taken offline; (c) Client may request export of Client Materials and Client Data during a 30-day export window in a standard format (CSV/JSON for structured data, original media files, and an HTML/PDF snapshot of page text on request) — **LevelUp will not withhold Client Data for non-payment**; (d) code and LevelUp Materials are not delivered unless a Code Buy-Out applies; (e) after the export window and at least one reminder e-mail, LevelUp deletes Client Data as described in the Terms and DPA.

9.5 **Transition assistance.** On request, LevelUp will provide reasonable transition assistance (for example, DNS changes, redirect lists, content export) at its hourly rate.

9.6 **Survival.** Sections 4 (amounts owed), 5, 6, 8.4, 9.4–9.6, 10, 11 and 12 survive.

## 10. Limitation of liability and indemnification

10.1 Section 11 (Limitation of liability) and Section 12 (Indemnification by Client) of the Terms apply to this Agreement.

10.2 The cap in Section 11.2 of the Terms is measured by the total fees paid by Client under this Agreement in the 12 months preceding the event giving rise to the claim.

10.3 The cap does not apply to Client's payment obligations, either party's indemnification obligations, breach of confidentiality, or the carve-outs required by law (Section 11.3 of the Terms).

## 11. Dispute resolution and governing law

Sections 15 (Dispute resolution — arbitration and class-action waiver) and 16 (Governing law, venue and international users) of the Terms apply. For business clients, the AAA Commercial Arbitration Rules apply. The prevailing party in any arbitration or action to collect fees is entitled to recover reasonable attorneys' fees and costs.

## 12. General

12.1 **Non-solicitation.** During an Order and for 12 months after, neither party will directly solicit for employment any employee or individual contractor of the other who worked on the Services, except through general advertisements.
12.2 **Subcontractors.** LevelUp may use subcontractors and sub-processors, remaining responsible for their performance.
12.3 **Publicity.** As described in Section 3.9 of the Terms.
12.4 **Entire agreement; amendments.** This Agreement, the Orders and incorporated documents are the entire agreement. Orders may be amended only in writing signed (including electronically) by both parties. Updates to this Agreement apply to new Orders and, for existing recurring plans, from the next renewal after at least 30 days' notice.
12.5 **Language.** English is the official and governing version. Translations are for convenience only.
12.6 **Counterparts and e-signature.** This Agreement and Orders may be accepted electronically or signed in counterparts.
12.7 **Notices.** As described in Section 18.6 of the Terms.

## 13. Contact

LevelUp Ecosystem
Attn: Richelieu Bonte, San Diego, California, USA (postal address available on request)
E-mail: contact@levelup-ecosystem.com

## 14. Electronic signature

The Client signs this Agreement and its Order electronically in the LevelUp Dashboard. LevelUp Ecosystem, represented by Richelieu Bonte, Owner, accepts them by issuing the Order. The signature certificate attached to the signed copy records the signer's name and title, the date and time (UTC), the IP address and the SHA-256 fingerprint of the document.
$msa_en$, now()),
  ('msa', 1, 'fr', 'Contrat-cadre de services', $msa_fr$> **Traduction — la version anglaise prévaut.** En cas de divergence avec la version anglaise du *Master Services Agreement*, la version anglaise fait foi, sauf disposition impérative contraire.

**LevelUp Ecosystem**
Date d'entrée en vigueur : date de la signature électronique par le Client (voir le certificat de signature)
Dernière mise à jour : 11 octobre 2026

---

> ### En bref
>
> - Ce Contrat s'applique lorsque vous payez LevelUp pour concevoir, construire, héberger, maintenir ou assister un site ou une application web.
> - **Vous obtenez une licence d'utilisation de votre site tant que votre plan Plateforme/Maintenance est actif. LevelUp reste propriétaire du code, des modèles, composants, de la plateforme et de la structure de base de données. Vous êtes propriétaire de vos contenus, de votre marque et des données de vos clients.** Rachat du code possible par accord écrit séparé.
> - Créations : acompte de 50 % pour réserver et démarrer (acquis dès le début des travaux), solde à la mise en ligne. Plans mensuels : facturés d'avance ; résiliation avec préavis de 30 jours.
> - Factures payables sous 14 jours. Relances à J+1, J+7 et J+14 ; suspension après 30 jours de retard (préavis de 7 jours) ; résiliation après 90 jours (préavis de 14 jours), puis 30 jours pour exporter vos données. Vos données vous sont toujours restituées sur demande.
> - Révisions, réception, support et délais de réponse sont définis ci-dessous. Objectif de disponibilité de 99,5 % par mois sur les plans de maintenance, avec avoirs si nous n'y parvenons pas pour des raisons qui dépendent de nous.
> - Responsabilité plafonnée aux sommes payées sur les 12 derniers mois. Droit californien ; arbitrage dans le comté de San Diego.

---

## 1. Parties, structure et définitions

1.1 Le présent Contrat-cadre (le « **Contrat** ») est conclu entre LevelUp Ecosystem, San Diego, Californie, États-Unis (adresse postale communiquée sur demande) (« **LevelUp** »), et le client identifié dans une Commande (le « **Client** »).

1.2 **Structure.** Chaque devis, proposition, cahier des charges, bon de commande ou achat en ligne accepté par le Client (une « **Commande** ») est régi par le présent Contrat, qui intègre les Conditions générales (« **Conditions** »), la Politique d'utilisation acceptable, la Politique de confidentialité et, si les Données Client comprennent des données personnelles, l'Avenant sur le traitement des données (DPA). Les termes non définis ont le sens donné dans les Conditions.

1.3 **Définitions.**
- « **Services de création** » : conception et développement ponctuels d'un site, d'une application, d'une personnalisation de modèle ou d'une fonctionnalité, décrits dans une Commande.
- « **Plan Plateforme/Maintenance** » : plan récurrent comprenant l'hébergement sur la Plateforme, la base de données, la sécurité, les mises à jour, les sauvegardes, l'accès au Dashboard, le support et le temps de modification inclus.
- « **Livrables** » : le Site Client et les autres éléments décrits dans une Commande, constitués d'Éléments LevelUp configurés avec des Éléments Client.
- « **Mise en ligne** » : date à laquelle le Site Client est rendu public pour la première fois sur le domaine du Client (ou un sous-domaine LevelUp à sa demande).
- « **Jour ouvré** » : du lundi au vendredi, hors jours fériés fédéraux américains, heure du Pacifique.

## 2. Services de création

2.1 **Déroulement.** Sauf mention contraire : (a) lancement et découverte ; (b) fourniture des contenus et accès par le Client ; (c) direction graphique (page d'accueil ou modèle clé) ; (d) construction des autres pages et fonctionnalités ; (e) relecture et révisions ; (f) réception et mise en ligne.

2.2 **Contenus du Client.** Le Client fournit textes, images, logos, listes de services, prix, mentions légales propres à son activité et validations aux dates de la Commande ou, à défaut, sous 10 Jours ouvrés. LevelUp peut utiliser des contenus provisoires ou des brouillons assistés par IA, clairement identifiés, que le Client doit relire et approuver avant la mise en ligne.

2.3 **Révisions.** Chaque Commande précise le nombre de tours de révision inclus (p. ex. Starter : 2 ; Business : 3). Un « tour » est une liste consolidée de modifications transmise par écrit. Les changements de structure approuvée, ajouts de pages ou fonctionnalités, ou tours supplémentaires sont des Demandes de modification.

2.4 **Demandes de modification.** Tout travail supplémentaire requiert une demande écrite (un e-mail suffit) précisant prix et délai, approuvée par le Client. Sauf devis, il est facturé au taux horaire en vigueur de LevelUp (actuellement 95 US$/heure), par tranches de 15 minutes.

2.5 **Réception.** Le Client dispose de 7 Jours ouvrés pour accepter un Livrable ou communiquer par écrit la liste des non-conformités substantielles à la Commande. LevelUp les corrige et relivre. Le Livrable est réputé accepté au premier des événements suivants : (a) acceptation écrite ; (b) expiration du délai sans liste écrite ; (c) mise en ligne à la demande du Client. Les défauts mineurs ne retardent pas la réception et sont corrigés selon l'article 2.7.

2.6 **Retards du Client.** Si le Client ne répond pas pendant 30 jours à une demande de contenu, d'avis ou de validation, LevelUp peut suspendre le projet et le reprogrammer selon ses disponibilités. Au-delà de 60 jours, LevelUp peut, après préavis écrit de 10 jours, clôturer le projet, facturer le travail réalisé (au taux horaire, plafonné au prix total) et imputer l'acompte. Des frais de réactivation de 150 US$ peuvent s'appliquer.

2.7 **Période de correction après mise en ligne.** Pendant 30 jours après la mise en ligne, LevelUp corrige gratuitement les défauts empêchant substantiellement les Livrables de fonctionner comme décrit, hors changements de périmètre, modifications du Client, changements de tiers et navigateurs/appareils non pris en charge.

2.8 **Accessibilité et SEO.** LevelUp applique des pratiques raisonnables d'accessibilité (objectif WCAG 2.1/2.2 niveau AA pour ses modèles) et des bases techniques de référencement. Le contenu, les images, les outils tiers et les modifications futures étant contrôlés par le Client, LevelUp ne garantit ni la conformité légale complète en matière d'accessibilité ni un quelconque classement. Audits d'accessibilité disponibles en option.

## 3. Plans Plateforme/Maintenance

3.1 **Plan obligatoire.** Les Sites Clients fonctionnant sur la Plateforme, un plan actif est nécessaire pour que le site reste en ligne, sauf rachat du code et migration réalisés.

3.2 **Services inclus** (selon la Commande ou la page tarifs au moment de l'achat) : hébergement et diffusion de contenu ; base de données gérée ; certificats SSL/TLS ; en-têtes et surveillance de sécurité ; mises à jour de la plateforme ; sauvegardes automatiques ; surveillance de disponibilité ; accès au Dashboard ; temps mensuel de modifications et délais de réponse indiqués. Le temps non utilisé n'est pas reporté.

3.3 **Non inclus** (sauf Commande) : nouvelles pages ou fonctionnalités, refonte, rédaction, photographie, publicité payante, licences tierces, conseil juridique/fiscal/conformité, réparation de dommages causés par le Client ou ses autres prestataires, travail hors Jours ouvrés.

3.4 **Support et délais de réponse cibles** (objectifs, non garanties) :

| Gravité | Exemple | Première réponse cible |
|---|---|---|
| Critique | Site hors ligne, incident de sécurité, réservation indisponible | 4 heures ouvrées (Premium : 2 heures ouvrées) |
| Élevée | Fonctionnalité majeure en panne sans contournement | 1 Jour ouvré |
| Normale | Mise à jour de contenu, bug mineur | 2 Jours ouvrés |
| Faible | Questions, suggestions | 5 Jours ouvrés |

3.5 **Objectif de disponibilité et avoirs.** LevelUp vise 99,5 % de disponibilité mensuelle des Sites Clients sur plans payants, mesurée par sa surveillance externe, hors : maintenance programmée annoncée 24 h à l'avance (ou d'urgence) ; pannes causées par le Client, ses contenus, son DNS/domaine/registraire ou des services tiers choisis par lui ; force majeure ; suspension prévue au Contrat ; fonctionnalités bêta. Si la disponibilité mensuelle est inférieure à 99,0 % pour des raisons relevant raisonnablement de LevelUp, le Client peut demander, dans les 30 jours suivant la fin du mois, un avoir de 10 % du plan du mois (25 % sous 97 %). Les avoirs s'imputent sur les factures futures, sont plafonnés à 50 % du montant mensuel, n'ont pas de valeur monétaire et constituent le seul remède en cas d'indisponibilité.

3.6 **Résiliation.** Le Client peut résilier un plan mensuel à tout moment avec un préavis écrit de 30 jours (Dashboard ou e-mail), sans prorata des mois entamés. Les plans annuels se résilient à l'échéance annuelle ; si une Commande accorde un prix annuel réduit ou inclut une année de maintenance dans un forfait, une résiliation anticipée n'ouvre pas droit à remboursement de l'année incluse, sauf obligation légale.

3.7 **Durée minimale.** Si une Commande prévoit une durée minimale (p. ex. 12 mois pour un forfait ou un prix de création réduit), le Client paie le plan pour cette durée. En cas de résiliation anticipée, le solde devient exigible, **réduit** des coûts économisés par LevelUp — ou, si la Commande accorde une remise sur la création en échange de la durée minimale, le Client peut à la place payer la différence entre le prix standard et le prix remisé, le montant le plus faible étant retenu.

## 4. Prix et paiement

4.1 **Acomptes.** Sauf mention contraire : 50 % du prix de création à l'acceptation de la Commande (l'« **Acompte** »), 50 % à la mise en ligne ou à la réception réputée, au premier des deux. Au-delà de 5 000 US$, paiement par jalons possible (p. ex. 40/30/30). LevelUp ne commence pas et ne réserve pas de capacité avant réception de l'Acompte.

4.2 **Acompte acquis au démarrage.** L'Acompte rémunère la réservation de capacité de production, la découverte, la planification et le design initial. Il est intégralement remboursable si le Client annule avant le début des travaux (appel de lancement ou premier livrable). Une fois les travaux commencés, il est **non remboursable** et imputé sur le travail réalisé. Si le Client résilie après le démarrage, il paie le travail réalisé au taux horaire (imputé sur l'Acompte), plafonné au prix total ; si le travail réalisé est inférieur à l'Acompte, LevelUp conserve l'Acompte à titre d'estimation raisonnable de la capacité réservée et des opportunités perdues, difficiles à chiffrer précisément.

4.3 **Frais récurrents.** Facturés d'avance mensuellement (ou annuellement) à partir de la mise en ligne ou de la date prévue, par prélèvement sur le moyen de paiement enregistré ou par facture.

4.4 **Échéance.** Factures payables sous 14 jours (« **Net 14** »), en dollars américains, sauf mention contraire.

4.5 **Procédure en cas d'impayé.**

| Jours de retard | Ce qui se passe |
|---|---|
| 0 (échéance) | Nouvelle tentative de prélèvement (si carte enregistrée) et rappel amical par e-mail. |
| 7 | Deuxième rappel. |
| 14 | Troisième rappel. Début des pénalités de retard (art. 4.6). |
| 23 | **Avis de suspension** par e-mail : suspension dans au moins 7 jours à défaut de paiement. |
| 30 | **Suspension** : accès Dashboard, mises à jour et support suspendus ; le site public peut être remplacé par une page neutre « temporairement indisponible ». Aucune donnée n'est supprimée. |
| 76 | **Avis de résiliation** par e-mail : résiliation dans au moins 14 jours à défaut de paiement. |
| 90 | **Résiliation** des Commandes concernées et de la licence. Début de la fenêtre d'export de 30 jours (art. 9). |
| 90 + 30 | Suppression des Données Client selon l'art. 9, après un dernier rappel par e-mail. |

Les avis sont envoyés aux adresses e-mail de facturation et du compte principal. Le Client peut éviter la suspension ou la résiliation à tout moment en payant ou en convenant par écrit d'un échéancier. Les paiements partiels s'imputent sur les factures les plus anciennes. LevelUp ne suspend pas pour un montant contesté de bonne foi par écrit avant l'échéance, si le Client paie la part non contestée et coopère rapidement.

4.6 **Pénalités et recouvrement.** Les sommes impayées depuis plus de 14 jours portent une pénalité de 1,0 % par mois (ou le taux légal maximal s'il est inférieur), estimation raisonnable des coûts administratifs et financiers du retard. Des frais de rétablissement de 50 US$ s'appliquent pour réactiver un site suspendu. Le Client rembourse les frais raisonnables de recouvrement, y compris honoraires d'avocat lorsque la loi le permet (l'article 1717 du Code civil californien rend ces clauses réciproques).

4.7 **Rétrofacturations.** Le Client soumet ses contestations à LevelUp avant sa banque. Une rétrofacturation portant sur des sommes dues constitue un manquement grave ; LevelUp peut suspendre les Services pendant la contestation et récupérer les frais de litige (actuellement jusqu'à 25 US$) si elle est tranchée en sa faveur.

4.8 **Taxes.** Prix hors taxes ; le Client paie les taxes applicables (hors impôts sur le revenu de LevelUp) et majore ses paiements en cas de retenue à la source.

4.9 **Évolution des prix.** Préavis écrit d'au moins 30 jours, application à la période suivante (ou au renouvellement pour les plans annuels) ; le Client peut résilier avant. Les créations à prix fixe acceptées ne sont pas affectées.

4.10 **Coûts tiers.** Domaines, polices ou extensions premium, API payantes, crédits SMS, banques d'images, usage IA au-delà des limites : refacturés au coût ou selon devis, sauf inclusion dans le plan.

## 5. Propriété intellectuelle et licence

5.1 **Éléments LevelUp.** LevelUp est propriétaire de tous les Éléments LevelUp au sens des Conditions (art. 3.2), y compris code, designs, modèles, mises en page, composants, Plateforme, Dashboard, LevelStudio, schémas de base de données, documentation et toutes améliorations réalisées pendant les Services, même développées spécifiquement pour le Client. Dans la mesure où des droits sur ces éléments reviendraient au Client, celui-ci les cède à LevelUp.

5.2 **Éléments Client.** Le Client est propriétaire des Éléments et Données Client et accorde à LevelUp la licence de l'article 3.3 des Conditions.

5.3 **Licence au Client.** Après paiement des sommes dues et tant que le plan est actif et à jour, LevelUp accorde au Client la licence de l'article 3.4 des Conditions. Elle prend fin à la résiliation, sous réserve de l'article 9.

5.4 **Réutilisation.** LevelUp peut réutiliser les Éléments LevelUp pour d'autres clients (art. 3.6 des Conditions), jamais les Éléments Client, la marque, les Données ou les Informations Confidentielles du Client. LevelUp ne créera pas pour un autre client une copie du site du Client reprenant sa combinaison distinctive de contenus, marque et identité visuelle.

5.5 **Rachat du code.** Le Client peut demander à tout moment un rachat : (a) **licence perpétuelle** du code front-end spécifique au projet avec un pack d'auto-hébergement ; ou (b) **cession** du code spécifique que LevelUp accepte par écrit de céder, avec licence perpétuelle non exclusive sur les composants partagés intégrés. Le rachat exige un accord écrit séparé signé, le paiement intégral des sommes dues et du prix du rachat et, si le site dépend de la base de données ou du Dashboard, un projet de migration. LevelUp peut refuser de transférer des composants qu'il tient de tiers ou qui font partie de la Plateforme.

5.6 **Composants tiers et open source** : régis par leurs propres licences.

5.7 **Garantie de propriété intellectuelle par LevelUp.** LevelUp défendra le Client contre les réclamations de tiers alléguant que les Éléments LevelUp, tels que fournis et utilisés conformément au Contrat, contrefont un droit d'auteur américain ou détournent un secret d'affaires, et paiera les dommages alloués ou transactionnels. LevelUp peut modifier ou remplacer l'élément, obtenir une licence, ou résilier les Services concernés avec remboursement des sommes payées d'avance non utilisées. Exclusions : Éléments Client, contenu IA publié par le Client, combinaisons avec des éléments non fournis par LevelUp, modifications par des tiers, usage après fourniture d'une alternative. Cet article définit l'entière responsabilité de LevelUp en matière de contrefaçon.

## 6. Protection et accès aux données

6.1 **Rôles.** Pour les Données Client concernant ses clients, visiteurs et personnel, le Client est responsable du traitement (« controller » / « business ») et LevelUp sous-traitant (« processor » / « service provider »). Le DPA s'applique et prévaut.
6.2 **Accès.** LevelUp n'accède aux Sites, bases et Données Client que pour les finalités de l'article 8.1 des Conditions, sous les engagements de confidentialité et de sécurité des Conditions et du DPA.
6.3 **Conformité du Client.** Le Client doit disposer d'une base légale et fournir les informations requises (sa propre politique de confidentialité et, si nécessaire, un mécanisme de consentement aux cookies). Les modèles fournis par LevelUp ne constituent pas un conseil juridique.
6.4 **Sauvegardes.** Elles servent à la reprise après sinistre, ne constituent pas un archivage, et la récupération des données saisies entre deux sauvegardes n'est pas garantie.

## 7. Obligations du Client

Le Client : (a) fournit des informations exactes et coopère en temps utile ; (b) désigne un interlocuteur habilité à valider ; (c) respecte les Conditions et l'AUP ; (d) détient les droits sur les Éléments Client ; (e) maintient l'enregistrement de son domaine (sauf gestion par LevelUp selon l'art. 4.3 des Conditions) et ses moyens de paiement à jour ; (f) respecte les lois propres à son secteur et à sa communication commerciale ; (g) ne demande rien d'illicite (LevelUp peut refuser).

## 8. Garanties et exclusions

8.1 **Mutuelles.** Chaque partie garantit avoir le pouvoir de conclure le Contrat.
8.2 **LevelUp** garantit une exécution professionnelle et soignée conforme aux standards du secteur. Seul remède : nouvelle exécution ou, à défaut dans un délai raisonnable, remboursement des sommes payées pour les Services non conformes. Réclamation dans les 30 jours suivant l'exécution.
8.3 **Le Client** garantit que ses Éléments et son usage des Services ne violent ni la loi ni les droits de tiers.
8.4 **Exclusions.** Hormis cet article 8, l'article 10 des Conditions s'applique.

## 9. Durée, résiliation et transition

9.1 **Durée.** Le Contrat commence à l'acceptation de la première Commande et se poursuit tant qu'une Commande est en vigueur.
9.2 **Résiliation pour faute.** Chaque partie peut résilier une Commande en cas de manquement grave non corrigé dans les 15 jours suivant une notification écrite (ou selon la procédure de l'art. 4.5 pour les impayés), ou immédiatement en cas d'insolvabilité ou de procédure collective de l'autre partie (dans la mesure permise par la loi).
9.3 **Suspension** : selon l'article 6 des Conditions (y compris immédiate pour activité illégale ou urgence de sécurité).
9.4 **Effets.** (a) Les sommes dues et les durées minimales engagées deviennent exigibles (sous réserve de l'art. 3.7) ; (b) la licence prend fin et le site peut être mis hors ligne ; (c) le Client peut demander l'export de ses Éléments et Données pendant 30 jours dans un format standard (CSV/JSON, fichiers médias d'origine, instantané HTML/PDF des textes sur demande) — **LevelUp ne retient pas les Données Client pour impayé** ; (d) le code et les Éléments LevelUp ne sont pas livrés sans rachat ; (e) après la fenêtre d'export et au moins un rappel, LevelUp supprime les Données Client selon les Conditions et le DPA.
9.5 **Assistance à la transition** (DNS, redirections, export de contenus) disponible au taux horaire.
9.6 **Survie** : articles 4 (sommes dues), 5, 6, 8.4, 9.4 à 9.6, 10, 11 et 12.

## 10. Limitation de responsabilité et garantie

10.1 Les articles 11 (Limitation de responsabilité) et 12 (Indemnisation par le Client) des Conditions s'appliquent.
10.2 Le plafond se calcule sur le total payé par le Client au titre du Contrat au cours des 12 mois précédant le fait générateur.
10.3 Le plafond ne s'applique pas aux obligations de paiement du Client, aux obligations d'indemnisation, à la violation de la confidentialité, ni aux exceptions légales (art. 11.3 des Conditions).

## 11. Litiges et droit applicable

Les articles 15 et 16 des Conditions s'appliquent. Pour les clients professionnels, les *Commercial Arbitration Rules* de l'AAA s'appliquent. La partie gagnante dans tout arbitrage ou action en recouvrement a droit au remboursement de ses honoraires d'avocat et frais raisonnables.

## 12. Dispositions générales

12.1 **Non-sollicitation.** Pendant une Commande et 12 mois après, aucune partie ne sollicite directement l'embauche d'un salarié ou prestataire individuel de l'autre ayant travaillé sur les Services, hors annonces générales.
12.2 **Sous-traitance.** LevelUp peut recourir à des sous-traitants et en reste responsable.
12.3 **Publicité** : selon l'article 3.9 des Conditions.
12.4 **Intégralité ; avenants.** Les Commandes ne peuvent être modifiées que par écrit signé (y compris électroniquement). Les mises à jour du Contrat s'appliquent aux nouvelles Commandes et, pour les plans récurrents existants, au renouvellement suivant après un préavis d'au moins 30 jours.
12.5 **Langue.** L'anglais est la version officielle et fait foi.
12.6 **Signature électronique** et exemplaires multiples admis.
12.7 **Notifications** : selon l'article 18.6 des Conditions.

## 13. Contact

LevelUp Ecosystem
À l'attention de Richelieu Bonte, San Diego, Californie, États-Unis (adresse postale communiquée sur demande)
E-mail : contact@levelup-ecosystem.com

## 14. Signature électronique

Le Client signe le présent Contrat et sa Commande électroniquement dans le Dashboard LevelUp. LevelUp Ecosystem, représentée par Richelieu Bonte, Owner, les accepte en émettant la Commande. Le certificat de signature joint à l'exemplaire signé indique le nom et la fonction du signataire, la date et l'heure (UTC), l'adresse IP et l'empreinte SHA-256 du document.
$msa_fr$, now())
on conflict (key, version, locale) do nothing;
