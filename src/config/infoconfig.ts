import type { InfobarContent } from '@/components/ui/infobar';

export const workspacesInfoContent: InfobarContent = {
  title: 'Organisations',
  sections: [
    {
      title: 'Principe',
      description:
        'Une organisation représente votre entreprise. Vos sites, votre équipe et vos fichiers y sont rattachés, et personne en dehors de l’organisation ne peut les voir.',
      links: []
    },
    {
      title: 'Changer d’organisation',
      description:
        'Utilisez le sélecteur en haut de la barre latérale pour passer d’une organisation ou d’un site à l’autre.',
      links: []
    }
  ]
};

export const teamInfoContent: InfobarContent = {
  title: 'Équipe & accès',
  sections: [
    {
      title: 'Rôles',
      description:
        'Propriétaire : tous les droits, y compris nommer d’autres propriétaires. Administrateur : gère l’équipe et les paramètres. Éditeur : modifie le contenu, les rendez-vous et les demandes. Lecture seule : consulte.',
      links: []
    },
    {
      title: 'Ajouter quelqu’un',
      description:
        'La personne crée d’abord son compte LevelUp (page Créer un compte), puis un administrateur l’ajoute ici avec son e-mail.',
      links: []
    }
  ]
};

export const billingInfoContent: InfobarContent = {
  title: 'Facturation',
  sections: [
    {
      title: 'Abonnement',
      description:
        'Votre abonnement et les fonctions de votre site sont gérés par l’équipe LevelUp. Contactez-nous pour toute modification.',
      links: [{ title: 'Écrire à LevelUp', url: 'mailto:contact@levelup-ecosystem.com' }]
    }
  ]
};

export const productInfoContent: InfobarContent = {
  title: 'Product Management',
  sections: [
    {
      title: 'Overview',
      description:
        'The Products page allows you to manage your product catalog. You can view all products in a table format with server-side functionality including sorting, filtering, pagination, and search capabilities. Use the "Add New" button to create new products.',
      links: [
        {
          title: 'Product Management Guide',
          url: '#'
        }
      ]
    },
    {
      title: 'Adding Products',
      description:
        'To add a new product, click the "Add New" button in the page header. You will be taken to a form where you can enter product details including name, description, price, category, and upload product images.',
      links: [
        {
          title: 'Adding Products Documentation',
          url: '#'
        }
      ]
    },
    {
      title: 'Editing Products',
      description:
        'You can edit existing products by clicking on a product row in the table. This will open the product edit form where you can modify any product information. Changes are saved automatically when you submit the form.',
      links: [
        {
          title: 'Editing Products Guide',
          url: '#'
        }
      ]
    },
    {
      title: 'Deleting Products',
      description:
        'Products can be deleted from the product listing table. Click the delete action for the product you want to remove. You will be asked to confirm the deletion before the product is permanently removed from your catalog.',
      links: [
        {
          title: 'Product Deletion Policy',
          url: '#'
        }
      ]
    },
    {
      title: 'Table Features',
      description:
        'The product table includes several powerful features to help you manage large product catalogs efficiently. You can sort columns by clicking on column headers, filter products using the filter controls, navigate through pages using pagination, and quickly find products using the search functionality.',
      links: [
        {
          title: 'Table Features Documentation',
          url: '#'
        },
        {
          title: 'Sorting and Filtering Guide',
          url: '#'
        }
      ]
    },
    {
      title: 'Product Fields',
      description:
        'Each product can have the following fields: Name (required), Description (optional text), Price (numeric value), Category (for organizing products), and Image Upload (for product photos). All fields can be edited when creating or updating a product.',
      links: [
        {
          title: 'Product Fields Specification',
          url: '#'
        }
      ]
    }
  ]
};
